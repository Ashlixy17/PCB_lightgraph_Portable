const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'pcblg-wand-'));
const failures = [];
let passed = 0;
async function test(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (error) { failures.push(name); console.error('FAIL ' + name + '\n' + error.stack); }
}

// 用逐像素搜索作独立参考，避免测试重复扫描线实现。
function expectedSelection(pixels, width, height, seed, tolerance, global) {
  const selected = new Set(), pending = [seed], visited = new Set();
  const color = pixels[seed], limit = 3 * 255 * 255 * (tolerance / 100) ** 2;
  const matches = p => color[3] === 0 ? pixels[p][3] === 0 : pixels[p][3] !== 0 &&
    pixels[p].slice(0, 3).reduce((sum, value, c) => sum + (value - color[c]) ** 2, 0) <= limit;
  if (global) {
    for (let p = 0; p < pixels.length; p++) if (matches(p)) selected.add(p);
  } else while (pending.length) {
    const p = pending.pop(); if (visited.has(p)) continue; visited.add(p);
    if (!matches(p)) continue; selected.add(p);
    const x = p % width, y = Math.floor(p / width);
    if (x > 0) pending.push(p - 1); if (x + 1 < width) pending.push(p + 1);
    if (y > 0) pending.push(p - width); if (y + 1 < height) pending.push(p + width);
  }
  return [...selected].sort((a, b) => a - b);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PCBLG_BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../PCB_lightgraph_portable.html')).href);
    if (await page.locator('#disclaimerClose').isVisible()) await page.locator('#disclaimerClose').click();

    async function source(width, height, pixels) {
      return page.evaluate(({ width, height, pixels }) => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (pixels) {
          const data = ctx.createImageData(width, height);
          pixels.forEach((color, p) => data.data.set(color, p * 4)); ctx.putImageData(data, 0, 0);
        } else { ctx.fillStyle = '#6699cc'; ctx.fillRect(0, 0, width, height); }
        resetRegions(); replaceProjectOrigin(ctx.getImageData(0, 0, width, height), canvas);
        masterState.light = false; setProcessingMode('gray', false); setExportControlsEnabled(true);
        setViewMode('overlay'); setGroupOpen('groupRegions', true, false);
        const camera = previewStates.composite; camera.zoom = 1; camera.pan = { x: 0, y: 0 };
        el('#regionWandTolerance').value = '0'; el('#regionWandTolerance').dispatchEvent(new Event('input'));
        el('#regionWandGlobal').checked = false; el('#regionOperation').value = 'new';
        refreshRegionUI(); renderAllPreviews();
        if (pixels) return Array.from({ length: width * height }, (_, p) => Array.from(state.origin.data.subarray(p * 4, p * 4 + 4)));
      }, { width, height, pixels });
    }
    async function point(x, y, selector = '#canvasComposite') {
      return page.locator(selector).evaluate((canvas, { x, y }) => {
        const key = Object.keys(quadPreviewCanvases).find(k => quadPreviewCanvases[k] === '#' + canvas.id);
        const st = key ? previewStates[quadPreviewKey(key)] : Object.values(previewStates).find(s => s.canvas === '#' + canvas.id);
        const view = key ? quadCamera : state.viewMode === 'split' ? splitCamera : st;
        const rect = calcPreviewRect(canvas.width, canvas.height, state.origin.width, state.origin.height, view.zoom, view.pan);
        const bounds = canvas.getBoundingClientRect();
        return { x: bounds.x + (rect.x + x / state.origin.width * rect.w) * bounds.width / canvas.width,
          y: bounds.y + (rect.y + y / state.origin.height * rect.h) * bounds.height / canvas.height };
      }, { x, y });
    }
    async function wand(x, y, operation = 'new', global = false, tolerance = 0) {
      if (await page.evaluate(() => regionState.tool) !== 'wand') await page.locator('[data-region-tool=wand]').click();
      await page.evaluate(({ operation, global, tolerance }) => {
        el('#regionOperation').value = operation; el('#regionOperation').dispatchEvent(new Event('change'));
        el('#regionWandGlobal').checked = global; el('#regionWandGlobal').dispatchEvent(new Event('change'));
        el('#regionWandTolerance').value = tolerance; el('#regionWandTolerance').dispatchEvent(new Event('input'));
      }, { operation, global, tolerance });
      const target = await point(x + .5, y + .5); await page.mouse.click(target.x, target.y);
      await page.waitForFunction(() => !regionState.wandJob);
    }
    async function regionPixels(id) {
      return page.evaluate(id => {
        const pixels = [];
        for (const [y, start, end] of regionState.items.find(item => item.id === id)?.spans || [])
          for (let x = start; x < end; x++) pixels.push(y * state.origin.width + x);
        return pixels;
      }, id);
    }

    const red = [220, 30, 30, 255], blue = [20, 40, 220, 255];
    const fixture = [red, red, blue, red, blue, blue, blue, blue,
      red, blue, blue, blue, red, blue, blue, blue,
      blue, blue, [230, 30, 30, 255], blue, blue, blue, blue, blue,
      blue, blue, [240, 30, 30, 255], blue, blue, blue, blue, blue,
      [200, 0, 0, 0], [0, 0, 200, 0], blue, [0, 200, 0, 0], blue, blue, blue, blue,
      blue, blue, blue, blue, [220, 30, 30, 128], blue, blue, blue];

    await test('connected vs global color selection, transparent colors and diagonal separation', async () => {
      for (const [seed, tolerance, global] of [[0, 0, false], [0, 0, true], [18, 5, false], [32, 0, false], [32, 0, true], [44, 0, true]]) {
        const normalized = await source(8, 6, fixture); await wand(seed % 8, Math.floor(seed / 8), 'new', global, tolerance);
        assert.deepEqual(await regionPixels(1), expectedSelection(normalized, 8, 6, seed, tolerance, global));
      }
    });
    await test('fixed-seed tolerance boundaries and scanline results match independent search', async () => {
      const width = 41, height = 29;
      const pixels = Array.from({ length: width * height }, (_, p) => {
        const x = p % width, y = Math.floor(p / width);
        return p % 61 === 0 ? [x, y, 0, 0] : [100 + (x * 7 + y * 3) % 30, 100 + (x * 3 + y * 11) % 30, 100 + (x * 13 + y * 5) % 30, 255];
      });
      await source(width, height, pixels);
      for (const tolerance of [0, 3, 5, 10, 100]) for (const global of [false, true]) {
        const actual = await page.evaluate(({ tolerance, global }) => {
          const iterator = computeWandSpans(state.origin, { x: 15, y: 10 }, tolerance, global); let result;
          do { result = iterator.next(); } while (!result.done);
          return result.value.flatMap(([y, start, end]) => Array.from({ length: end - start }, (_, i) => y * state.origin.width + start + i));
        }, { tolerance, global });
        assert.deepEqual(actual, expectedSelection(pixels, width, height, 10 * width + 15, tolerance, global));
      }
      await source(3, 1, [[100, 100, 100, 255], [125, 125, 125, 255], [150, 150, 150, 255]]);
      await wand(0, 0, 'new', false, 10); assert.deepEqual(await regionPixels(1), [0, 1]);
    });
    await test('new/add/subtract are exclusive, traverse occupied pixels, and undo atomically', async () => {
      await source(6, 2, Array.from({ length: 12 }, () => red));
      await page.evaluate(() => {
        regionState.items = [{ id: 1, name: 'Barrier', spans: [[0, 2, 3], [1, 2, 3]], offsets: { gray: {}, color: {} } }];
        regionState.nextId = 2; touchRegionMasks(); refreshRegionUI();
      });
      await wand(0, 0); assert.deepEqual(await regionPixels(1), [2, 8]);
      assert.deepEqual(await regionPixels(2), [0, 1, 3, 4, 5, 6, 7, 9, 10, 11]);
      const history = await page.evaluate(() => regionState.undo.length);
      await wand(0, 0); assert.equal(await page.evaluate(() => regionState.items.length), 2);
      assert.equal(await page.evaluate(() => regionState.undo.length), history);
      assert.equal(await page.locator('#regionWandStatus').isVisible(), false);
      assert.equal(await page.locator('#regionTools').getAttribute('aria-busy'), 'false');
      await page.evaluate(() => selectRegion(2)); await wand(0, 0, 'subtract');
      assert.equal(await page.evaluate(() => regionState.items.length), 1);
      await page.evaluate(() => undoRegionChange(false)); assert.equal(await page.evaluate(() => regionState.items.length), 2);
      await page.evaluate(() => undoRegionChange(true)); assert.equal(await page.evaluate(() => regionState.items.length), 1);
      await page.evaluate(() => selectRegion(1)); await wand(0, 0, 'add');
      assert.equal((await regionPixels(1)).length, 12);
      await page.evaluate(() => undoRegionChange(false)); assert.deepEqual(await regionPixels(1), [2, 8]);
    });
    await test('wand masks survive project round trips and only change owned production pixels', async () => {
      await source(8, 6, fixture); await wand(0, 0);
      const result = await page.evaluate(() => {
        getExportSettings(); const before = new Uint8ClampedArray(state.layers.Top_Silk.data);
        selectedRegion().offsets.gray.silkThreshold = -255; regionState.revision++; updateProcess(); getExportSettings();
        const changed = [], owners = regionOwners(8, 6);
        for (let p = 0; p < 48; p++) for (let c = 0; c < 4; c++)
          if (state.layers.Top_Silk.data[p * 4 + c] !== before[p * 4 + c]) changed.push({ p, owner: owners[p] });
        const saved = serializeRegions(); const restored = validateRegions(JSON.parse(JSON.stringify(saved)), state.origin);
        return { changed, saved, restored };
      });
      assert.ok(result.changed.length > 0); assert.ok(result.changed.every(change => change.owner === 1));
      assert.deepEqual(result.restored[0].spans, result.saved.items[0].spans);
      assert.equal(result.restored[0].offsets.gray.silkThreshold, -255);
      const downloading = page.waitForEvent('download'); await page.evaluate(() => el('#mSave').click()); const download = await downloading;
      const archive = path.join(artifacts, 'wand.pcblg'); await download.saveAs(archive);
      const saved = await page.evaluate(() => serializeRegions());
      await source(12, 8); await page.locator('#projInput').setInputFiles(archive);
      await page.waitForFunction(() => state.origin.width === 8 && regionState.items.length === 1);
      assert.deepEqual(await page.evaluate(() => serializeRegions()), saved);
    });
    await test('Select click/drag preserves region geometry in overlay, split and quad views', async () => {
      await source(256, 192); await page.evaluate(() => {
        regionState.items = [{ id: 1, name: 'Test', spans: Array.from({ length: 30 }, (_, y) => [y + 50, 60, 100]), offsets: { gray: {}, color: {} } }];
        regionState.nextId = 2; touchRegionMasks(); refreshRegionUI();
      });
      const masks = await page.evaluate(() => serializeRegions());
      for (const [view, selector] of [['overlay', '#canvasComposite'], ['split', '#canvasSilk'], ['quad', '#canvasQuadSilk']]) {
        await page.evaluate(view => {
          setViewMode(view); regionState.tool = 'select'; refreshRegionUI();
          const camera = view === 'quad' ? quadCamera : view === 'split' ? splitCamera : previewStates.composite;
          camera.zoom = 2; camera.pan = { x: 0, y: 0 }; renderAllPreviews();
        }, view);
        const target = await point(80, 65, selector); await page.mouse.click(target.x, target.y);
        assert.equal(await page.evaluate(() => regionState.selected), 1, view);
        const start = await point(130, 96, selector);
        await page.mouse.move(start.x, start.y); await page.mouse.down();
        await page.mouse.move(start.x + 3, start.y); await page.mouse.up();
        assert.equal(await page.evaluate(() => regionState.selected), 0, 'small movement still clicks');
        await page.evaluate(() => selectRegion(1));
        const before = await page.evaluate(view => ({ ...(view === 'quad' ? quadCamera : view === 'split' ? splitCamera : previewStates.composite).pan }), view);
        await page.mouse.move(start.x, start.y); await page.mouse.down();
        await page.mouse.move(start.x + 25, start.y + 18, { steps: 5 }); await page.mouse.up();
        assert.equal(await page.evaluate(() => regionState.selected), 1, 'drag does not select background');
        const after = await page.evaluate(view => ({ ...(view === 'quad' ? quadCamera : view === 'split' ? splitCamera : previewStates.composite).pan }), view);
        assert.notDeepEqual(after, before); assert.deepEqual(await page.evaluate(() => serializeRegions()), masks);
        assert.equal(await page.evaluate(() => regionState.pointer), null);
      }
      await page.evaluate(() => { setViewMode('overlay'); previewStates.composite.zoom = 1; previewStates.composite.pan = { x: 0, y: 0 }; renderAllPreviews(); selectRegion(1); });
      const bounds = await page.locator('#canvasComposite').boundingBox();
      await page.mouse.move(bounds.x + 2, bounds.y + 2); await page.mouse.down();
      assert.equal(await page.evaluate(() => regionState.pointer.point), null, 'blank canvas starts a drag');
      await page.mouse.move(bounds.x + 32, bounds.y + 22); assert.equal(await page.evaluate(() => regionState.pointer.dragging), true);
      await page.mouse.up(); assert.equal(await page.evaluate(() => regionState.selected), 1);
    });
    await test('wand samples original pixels correctly after preview zoom and pan', async () => {
      const width = 256, height = 192;
      const pixels = Array.from({ length: width * height }, (_, p) => p % width >= 100 && p % width < 115 && Math.floor(p / width) >= 80 && Math.floor(p / width) < 90 ? red : blue);
      await source(width, height, pixels);
      await page.evaluate(() => { previewStates.composite.zoom = 2; previewStates.composite.pan = { x: 40, y: -20 }; renderAllPreviews(); });
      await wand(107, 85); assert.deepEqual(await regionPixels(1), expectedSelection(pixels, width, height, 85 * width + 107, 0, false));
    });
    await test('four languages and narrow widths keep five tools and wand controls usable', async () => {
      await source(256, 192); await page.locator('[data-region-tool=wand]').click();
      await page.evaluate(() => { el('#regionWandTolerance').value = '15'; el('#regionWandTolerance').dispatchEvent(new Event('input')); });
      for (const width of [1000, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const language of ['zh-CN', 'zh-TW', 'en', 'ja']) {
          await page.evaluate(language => setLanguage(language, false), language);
          await page.locator('#regionWandControls').scrollIntoViewIfNeeded();
          const geometry = await page.locator('#regionTools').evaluate(tools => ({ width: tools.clientWidth, content: tools.scrollWidth,
            clipped: [...tools.querySelectorAll('button')].some(button => button.scrollWidth > button.clientWidth + 1) }));
          assert.ok(geometry.content <= geometry.width, JSON.stringify({ width, language, ...geometry }));
          assert.equal(geometry.clipped, false, JSON.stringify({ width, language, ...geometry }));
          await page.screenshot({ path: path.join(artifacts, `wand-${language}-${width}.png`) });
        }
      }
      await page.evaluate(() => setLanguage('zh-CN', false));
    });
    await test('near-limit wand yields, ignores repeated clicks and cancels before commit', async () => {
      await source(4000, 3999); await page.locator('[data-region-tool=wand]').click();
      const timing = await page.evaluate(async () => {
        let heartbeats = 0; const timer = setInterval(() => heartbeats++, 0), start = performance.now();
        const first = startRegionWand({ x: 10, y: 10 }); const job = regionState.wandJob;
        await startRegionWand({ x: 20, y: 20 }); const ignored = regionState.wandJob === job;
        await first; clearInterval(timer);
        const items = regionState.items, spans = items[0]?.spans;
        return { elapsed: performance.now() - start, heartbeats, ignored, count: items.length,
          spans: spans.length, first: spans[0], last: spans[spans.length - 1], history: regionState.undo.length };
      });
      assert.equal(timing.count, 1); assert.equal(timing.spans, 3999); assert.equal(timing.history, 1);
      assert.deepEqual(timing.first, [0, 0, 4000]); assert.deepEqual(timing.last, [3998, 0, 4000]);
      assert.ok(timing.heartbeats > 5); assert.equal(timing.ignored, true); console.log('PERF ' + JSON.stringify(timing));
      await page.evaluate(() => { undoRegionChange(false); window.wandPromise = startRegionWand({ x: 10, y: 10 }); });
      await page.waitForFunction(() => !!regionState.wandJob);
      assert.ok(await page.locator('#regionWandStatus').isVisible());
      await page.keyboard.press('Escape'); await page.evaluate(() => window.wandPromise);
      assert.equal(await page.evaluate(() => regionState.items.length), 0);
      assert.equal(await page.evaluate(() => regionState.tool), 'select');
      assert.equal(await page.locator('#regionWandStatus').isVisible(), false);
      await page.evaluate(() => {
        window.originalBuildRegionChange = buildRegionChange;
        window.wandReachedMerge = false;
        buildRegionChange = function* (...args) {
          const iterator = window.originalBuildRegionChange(...args), first = iterator.next();
          window.wandReachedMerge = true;
          if (first.done) return first.value;
          yield; return yield* iterator;
        };
        regionState.tool = 'wand'; el('#regionWandGlobal').checked = true; refreshRegionUI();
        window.wandPromise = startRegionWand({ x: 10, y: 10 });
      });
      try {
        await page.waitForFunction(() => window.wandReachedMerge && !!regionState.wandJob);
        await page.evaluate(() => el('[data-region-tool=select]').click());
        await page.evaluate(() => window.wandPromise);
        assert.equal(await page.evaluate(() => regionState.items.length), 0, 'cancel during ownership merge is atomic');
        assert.equal(await page.evaluate(() => regionState.undo.length), 0);
      } finally { await page.evaluate(() => { buildRegionChange = window.originalBuildRegionChange; }); }
      for (const action of ['tolerance', 'global', 'parameter', 'tool', 'undo', 'fold', 'origin']) {
        await page.evaluate(action => {
          setGroupOpen('groupRegions', true, false); regionState.tool = 'wand'; refreshRegionUI();
          window.wandPromise = startRegionWand({ x: 10, y: 10 });
          if (action === 'tolerance') el('#regionWandTolerance').dispatchEvent(new Event('input'));
          if (action === 'global') el('#regionWandGlobal').dispatchEvent(new Event('change'));
          if (action === 'parameter') el('#sliderGraySilk input').dispatchEvent(new Event('input'));
          if (action === 'tool') el('[data-region-tool=select]').click();
          if (action === 'undo') undoRegionChange(false);
          if (action === 'fold') setGroupOpen('groupRegions', false, false);
          if (action === 'origin') replaceProjectOrigin(state.originCanvas.getContext('2d').getImageData(0, 0, state.origin.width, state.origin.height), state.originCanvas);
        }, action);
        await page.evaluate(() => window.wandPromise);
        assert.equal(await page.evaluate(() => regionState.items.length), 0, action);
        assert.equal(await page.evaluate(() => regionState.wandJob), null, action);
      }
      await source(32, 24);
    });
    await test('right-button wand latches the reverse operation, restores UI and preserves history', async () => {
      for (const operation of ['add', 'subtract']) {
        await source(4, 2, [red, red, blue, blue, red, red, blue, blue]);
        await page.evaluate(operation => {
          regionState.items = [{ id: 1, name: 'Target', spans: [[0, operation === 'add' ? 0 : 2, 4], [1, operation === 'add' ? 0 : 2, 4]], offsets: { gray: {}, color: {} } }];
          regionState.nextId = 2; regionState.selected = 1; touchRegionMasks();
          regionState.tool = 'wand'; el('#regionOperation').value = operation; refreshRegionUI();
        }, operation);
        const before = await page.evaluate(() => ({ regions: serializeRegions(), pan: { ...previewStates.composite.pan } }));
        const seed = await point(.5, .5); await page.mouse.move(seed.x, seed.y); await page.mouse.down({ button: 'right' });
        assert.equal(await page.locator('#regionOperations .active').getAttribute('data-region-operation'), operation === 'add' ? 'subtract' : 'add');
        assert.equal(await page.locator('#regionOperation').inputValue(), operation);
        await page.mouse.up({ button: 'right' }); await page.waitForFunction(() => !regionState.wandJob);
        const result = await page.evaluate(() => ({ owner: regionOwners(4, 2)[0], pan: { ...previewStates.composite.pan }, history: regionState.undo.length, regions: serializeRegions() }));
        assert.equal(result.owner, operation === 'add' ? 0 : 1);
        assert.deepEqual(result.pan, before.pan); assert.equal(result.history, 1);
        assert.equal(await page.evaluate(() => regionState.press), null);
        assert.equal(await page.locator('#regionOperations .active').getAttribute('data-region-operation'), operation);
        await page.evaluate(() => undoRegionChange(false)); assert.deepEqual(await page.evaluate(() => serializeRegions()), before.regions);
        await page.evaluate(() => undoRegionChange(true)); assert.deepEqual(await page.evaluate(() => serializeRegions()), result.regions);
      }
    });
    await test('right wand survives release while busy and clears on blur, cancel or capture loss', async () => {
      await source(4000, 3999);
      async function setup() {
        await page.evaluate(() => {
          resetRegions();
          regionState.items = [{ id: 1, name: 'Target', spans: Array.from({ length: 3999 }, (_, y) => [y, 0, 2000]), offsets: { gray: {}, color: {} } }];
          regionState.nextId = 2; regionState.selected = 1; touchRegionMasks();
          setGroupOpen('groupRegions', true, false); regionState.tool = 'wand'; el('#regionOperation').value = 'add';
          el('#regionWandGlobal').checked = false; refreshRegionUI(); renderAllPreviews();
        });
        const seed = await point(10.5, 10.5); await page.mouse.move(seed.x, seed.y); await page.mouse.down({ button: 'right' });
      }
      await setup();
      assert.equal(await page.locator('#regionOperations .active').getAttribute('data-region-operation'), 'subtract');
      await page.mouse.up({ button: 'right' });
      assert.equal(await page.evaluate(() => !!regionState.wandJob), true);
      assert.equal(await page.evaluate(() => regionState.press), null);
      assert.equal(await page.locator('#regionOperations .active').getAttribute('data-region-operation'), 'add');
      await page.waitForFunction(() => !regionState.wandJob);
      assert.equal(await page.evaluate(() => regionState.items.length), 0);
      assert.equal(await page.evaluate(() => regionState.undo.length), 1);
      assert.equal(await page.locator('#regionOperation').inputValue(), 'new');
      for (const action of ['escape', 'blur', 'tool', 'cancel', 'lost']) {
        await setup(); const before = await page.evaluate(() => serializeRegions());
        if (action === 'escape') await page.keyboard.press('Escape');
        else await page.evaluate(action => {
          if (action === 'blur') window.dispatchEvent(new Event('blur'));
          if (action === 'tool') el('[data-region-tool=select]').click();
          if (action === 'cancel') el('#canvasComposite').dispatchEvent(new PointerEvent('pointercancel', { pointerId: regionState.press.pointerId }));
          if (action === 'lost') el('#canvasComposite').releasePointerCapture(regionState.press.pointerId);
        }, action);
        const next = await point(20.5, 20.5); await page.mouse.move(next.x, next.y); await page.mouse.up({ button: 'right' });
        await page.waitForFunction(() => !regionState.wandJob);
        assert.deepEqual(await page.evaluate(() => serializeRegions()), before, action);
        assert.equal(await page.evaluate(() => regionState.undo.length), 0, action);
        assert.equal(await page.evaluate(() => regionState.press), null, action);
        assert.equal(await page.locator('#regionOperations .active').getAttribute('data-region-operation'), 'add', action);
      }
      await source(32, 24);
    });
    assert.deepEqual(errors, [], 'browser runtime errors');
    console.log(JSON.stringify({ passed, failures, artifacts }));
  } finally { await browser.close(); }
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
