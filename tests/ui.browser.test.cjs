const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

const url = pathToFileURL(path.resolve(__dirname, '../PCB_lightgraph_portable.html')).href;
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'pcblg-ui-'));
let passed = 0;
const failures = [], errors = [];
async function test(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (error) { failures.push(name); console.error('FAIL ' + name + '\n' + error.stack); }
}
async function fixture(page) {
  await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 240; c.height = 160;
    const ctx = c.getContext('2d'), img = ctx.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      img.data.set([(x * 7 + y) % 256, (y * 5 + x) % 256, (x * 3 + y * 7) % 256, x % 19 ? 255 : 0], i);
    }
    ctx.putImageData(img, 0, 0); resetRegions(); replaceProjectOrigin(img, c); setExportControlsEnabled(true); syncImportDrawingButton();
    regionState.items = [1, 2].map(id => ({ id, name: '区域 ' + id, offsets: { gray: { silkThreshold: 30 * id }, color: { silkThresh: 15 * id } },
      spans: Array.from({ length: 60 }, (_, y) => [y + 30, id === 1 ? 20 : 130, id === 1 ? 100 : 220]) }));
    regionState.nextId = 3; regionState.selected = 1; touchRegionMasks(); refreshRegionUI(); updateProcess();
  });
}
async function downloadPNG(page) {
  const event = page.waitForEvent('download');
  await page.evaluate(() => exportSelectedLayer());
  const download = await event, filename = path.join(artifacts, Math.random().toString(16).slice(2) + '.png');
  await download.saveAs(filename);
  return PNG.sync.read(fs.readFileSync(filename));
}
async function bounds(page, selector) {
  const box = await page.locator(selector).boundingBox(), viewport = page.viewportSize();
  assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
    selector + ': ' + JSON.stringify({ box, viewport }));
}
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PCBLG_BROWSER_CHANNEL || 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await test('single GitHub UI startup preserves disclaimer close rules', async () => {
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-theme')), false);
      for (const operation of ['new', 'add', 'subtract']) assert.ok(await page.locator('[data-region-operation=' + operation + ']').isDisabled());
      assert.equal(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(13, 17, 23)');
      assert.ok(await page.locator('#modalBack').evaluate(node => node.classList.contains('show')));
      await page.mouse.click(2, 2);
      assert.ok(await page.locator('#disclaimerClose').isVisible());
      await page.screenshot({ path: path.join(artifacts, 'disclaimer.png') });
      await page.locator('#disclaimerRemember').check(); await page.locator('#disclaimerClose').click();
      assert.equal(await page.locator('.main').evaluate(node => node.inert), false);
    });
    await test('click-only menus, repeated click and outside click', async () => {
      const trigger = page.locator('#menuOption > button'), panel = page.locator('#menuOption > .dropdown');
      await trigger.hover(); assert.equal(await panel.isVisible(), false);
      await trigger.click(); assert.ok(await panel.isVisible());
      await trigger.click(); assert.equal(await panel.isVisible(), false);
      await trigger.click(); await page.locator('.hint').click(); assert.equal(await panel.isVisible(), false);
    });
    await test('menus support arrows, nested Escape, Enter, Space and disabled items', async () => {
      await page.locator('#menuOption > button').focus(); await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(() => document.activeElement.parentElement.id), 'subEdge');
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => document.activeElement.parentElement.id), 'subExp');
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('End');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'mDP');
      await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement.parentElement.id), 'subExp');
      await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement.parentElement.id), 'subEdge');
      await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement.parentElement.id), 'menuOption');
      await page.keyboard.press('Space'); assert.ok(await page.locator('#menuOption > .dropdown').isVisible());
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(() => document.activeElement.parentElement.id), 'subScale');
      await page.keyboard.press('Escape');
      await page.locator('#menuFile > button').focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'mLoad');
      assert.ok(await page.locator('#mSave').isDisabled());
      await page.evaluate(() => el('#mSave').click());
      await page.evaluate(() => el('#mExport').click());
      assert.equal(await page.locator('#toast').isVisible(), false, 'disabled export must not run');
      await page.keyboard.press('Escape');
    });
    await test('legacy theme preference is removed; only GitHub UI remains after refresh', async () => {
      const legacy = await browser.newContext();
      await legacy.addInitScript(() => localStorage.setItem('pcblg_theme', 'original'));
      const p = await legacy.newPage(); await p.goto(url); await p.locator('#disclaimerClose').click();
      for (let i = 0; i < 2; i++) {
        assert.equal(await p.locator('#mToggleTheme').count(), 0);
        assert.equal(await p.evaluate(() => localStorage.getItem('pcblg_theme')), null);
        assert.equal(await p.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(13, 17, 23)');
        assert.equal(await p.evaluate(() => typeof window.applyUITheme), 'undefined');
        if (!i) { await p.reload(); await p.locator('#disclaimerClose').click(); }
      }
      await legacy.close(); await page.evaluate(() => setProcessingMode('color', false));
    });
    await test('selection panels use native change events and keyboard navigation', async () => {
      await page.evaluate(() => { window.selectChanges = 0; el('#selectMask').addEventListener('change', () => window.selectChanges++); });
      await page.locator('[data-select-id=selectMask]').click();
      assert.equal(await page.locator('#selectPopup [aria-selected=true]').count(), 1);
      assert.ok(await page.locator('#selectPopup [aria-selected=true] svg').isVisible());
      await page.keyboard.press('End'); await page.keyboard.press('Enter');
      assert.equal(await page.locator('#selectMask').inputValue(), 'purple');
      assert.equal(await page.evaluate(() => window.selectChanges), 1);
      assert.equal(await page.locator('[data-select-id=selectMask] .ui-select-label').innerText(), '紫色');
      await page.locator('[data-select-id=selectMask]').focus(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Home'); await page.keyboard.press('Space');
      assert.equal(await page.locator('#selectMask').inputValue(), 'blue');
      assert.equal(await page.evaluate(() => window.selectChanges), 2);
      await page.locator('[data-select-id=selectMask]').click(); await page.locator('.hint').click();
      assert.equal(await page.locator('#selectPopup').isVisible(), false);
    });
    await fixture(page);
    await test('save enabled with an image; regions use plain radios with stable hover and arrow navigation', async () => {
      assert.equal(await page.locator('#mSave').isDisabled(), false);
      await page.evaluate(() => setGroupOpen('groupRegions', true, false));
      const radio = page.locator('.region-choice input[value="1"]'), row = radio.locator('..');
      assert.equal(await page.locator('#regionList button').count(), 0);
      assert.ok(await radio.isChecked());
      const before = await row.evaluate(node => ({ background: getComputedStyle(node).backgroundColor, border: getComputedStyle(node).borderWidth }));
      await row.hover();
      assert.deepEqual(await row.evaluate(node => ({ background: getComputedStyle(node).backgroundColor, border: getComputedStyle(node).borderWidth })), before);
      assert.equal(before.background, 'rgba(0, 0, 0, 0)'); assert.equal(before.border, '0px');
      await page.locator('.region-choice').filter({ hasText: '全局' }).click();
      assert.equal(await page.evaluate(() => regionState.selected), 0);
      await page.keyboard.press('ArrowDown'); assert.equal(await page.evaluate(() => regionState.selected), 1);
      await page.keyboard.press('ArrowDown'); assert.equal(await page.evaluate(() => regionState.selected), 2);
      await page.keyboard.press('ArrowUp'); assert.equal(await page.evaluate(() => regionState.selected), 1);
      assert.equal(await page.locator('[data-i18n=regionDrawing]').innerText(), '区域划取');
      assert.equal(await page.locator('[data-region-operation]').count(), 3);
      assert.equal(await page.locator('[data-select-id=regionOperation]').count(), 0);
      await page.locator('[data-region-operation=add]').click();
      assert.equal(await page.locator('#regionOperation').inputValue(), 'add');
      assert.equal(await page.locator('[data-region-operation=add]').getAttribute('aria-pressed'), 'true');
      await page.evaluate(() => selectRegion(0));
      assert.equal(await page.locator('#regionOperation').inputValue(), 'new');
      for (const operation of ['add', 'subtract']) assert.ok(await page.locator('[data-region-operation=' + operation + ']').isDisabled());
      await page.evaluate(() => selectRegion(1));
      await page.screenshot({ path: path.join(artifacts, 'region-radios.png') });
    });
    await test('select synchronization after restore/reset/language/disabled state', async () => {
      await page.evaluate(() => { const c = gatherControls(); c.maskColorIndex = 2; restoreControls(c); });
      assert.equal(await page.locator('[data-select-id=selectMask] .ui-select-label').innerText(), '红色');
      await page.evaluate(() => setLanguage('en', false));
      assert.equal(await page.locator('[data-select-id=selectMask] .ui-select-label').innerText(), 'Red');
      assert.equal(await page.locator('#mToggleTheme').count(), 0);
      await page.evaluate(() => setExportControlsEnabled(false));
      assert.ok(await page.locator('[data-select-id=selectExportLayer]').isDisabled());
      await page.evaluate(() => { setExportControlsEnabled(true); resetAllSettings(); setLanguage('zh-CN', false); });
      assert.equal(await page.locator('[data-select-id=grayPreviewMask] .ui-select-label').innerText(), '蓝色');
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-theme')), false);
    });
    await test('Escape closes selection popup before canceling active canvas selection', async () => {
      await page.evaluate(() => setGroupOpen('groupRegions', true, false));
      await page.locator('[data-region-tool=rect]').click();
      await page.locator('[data-select-id=grayPreviewMask]').click();
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => regionState.tool), 'rect');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.selectId), 'grayPreviewMask');
      await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => regionState.tool), 'select');
    });
    await test('GitHub modal traps/restores focus, red Yes and gray No default', async () => {
      await page.locator('#regionDelete').click();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'regionDeleteNo');
      assert.equal(await page.locator('#regionDeleteYes').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(218, 54, 51)');
      assert.equal(await page.locator('#regionDeleteNo').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(33, 40, 48)');
      await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'regionDeleteYes');
      await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'regionDeleteNo');
      assert.ok(await page.locator('.main').evaluate(node => node.inert));
      await page.screenshot({ path: path.join(artifacts, 'delete.png') });
      await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement.id), 'regionDelete');
      assert.equal(await page.locator('.main').evaluate(node => node.inert), false);
    });
    await test('dynamic dialogs, dropdown focus and crop/paint cancellation keep original behavior', async () => {
      for (const [open, cancel] of [['openColorDialog', 'dlgColorCancel'], ['openFilterDialog', 'dlgFilterCancel'], ['openDPDialog', 'dlgDPCancel'], ['openRegionRename', 'regionNameCancel'], ['openRegionCopy', 'regionCopyCancel']]) {
        await page.evaluate(fn => window[fn](), open);
        assert.equal(await page.locator('#modalBody').evaluate(node => getComputedStyle(node).borderRadius), '12px');
        assert.ok(await page.locator('#' + cancel).isVisible());
        await page.keyboard.press('Escape'); assert.equal(await page.locator('#modalBack').evaluate(node => node.classList.contains('show')), false);
      }
      await page.evaluate(() => openPaintEditor());
      await page.locator('#paintBrushModeWrap .ui-select-button').click();
      await page.keyboard.press('Escape'); assert.ok(await page.locator('#paintCancel').isVisible());
      await page.screenshot({ path: path.join(artifacts, 'paint.png') });
      await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => paintSession), null);
      await page.evaluate(async () => { const image = new Image(); image.src = state.originCanvas.toDataURL(); await image.decode(); window.cropResult = null; openCropDialog(image, rect => window.cropResult = rect); });
      await page.screenshot({ path: path.join(artifacts, 'crop.png') });
      await page.keyboard.press('Escape');
      assert.deepEqual(await page.evaluate(() => window.cropResult), { x: 0, y: 0, w: 240, h: 160 });
    });
    await test('UI updates preserve camera, numeric history, regions and layer/export pixels in both modes', async () => {
      for (const mode of ['gray', 'color']) {
        await page.evaluate(mode => {
          setProcessingMode(mode, true); selectRegion(1); previewStates.composite.zoom = 1.5; previewStates.composite.pan = { x: 8, y: 4 };
          const input = el(mode === 'gray' ? '#regionLocal_sliderGraySilk input' : '#regionLocal_sliderSilk input');
          input.value = 210; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change'));
          updateProcess(); renderAllPreviews();
        }, mode);
        const before = await page.evaluate(() => ({ regions: captureRegionSnapshot(), undo: regionState.undo.length, redo: regionState.redo.length,
          zoom: previewStates.composite.zoom, pan: { ...previewStates.composite.pan }, args: buildNativeProjectArgs(), layers: Object.fromEntries(Object.entries(state.layers).map(([k, v]) => [k, Array.from(v.data)])) }));
        const pngBefore = await downloadPNG(page);
        await page.evaluate(() => { setLanguage('en', false); setViewMode('quad'); setViewMode('overlay'); setLanguage('zh-CN', false); refreshInterfaceControls(); });
        const after = await page.evaluate(() => ({ regions: captureRegionSnapshot(), undo: regionState.undo.length, redo: regionState.redo.length,
          zoom: previewStates.composite.zoom, pan: { ...previewStates.composite.pan }, args: buildNativeProjectArgs(), layers: Object.fromEntries(Object.entries(state.layers).map(([k, v]) => [k, Array.from(v.data)])) }));
        assert.deepEqual(after, before);
        const pngAfter = await downloadPNG(page); assert.deepEqual(pngAfter.data, pngBefore.data);
        assert.equal(before.args.portable.schemaVersion, 5); assert.ok(!('theme' in before.args.portable));
        await page.evaluate(() => { undoRegionChange(false); undoRegionChange(true); refreshInterfaceControls(); });
      }
    });
    await test('control synchronization does not duplicate proxies/events', async () => {
      const count = await page.locator('select:not([data-ui=segmented])').count();
      await page.evaluate(() => { for (let i = 0; i < 10; i++) refreshInterfaceControls(); });
      assert.equal(await page.locator('.ui-select-button').count(), count);
      const before = await page.evaluate(() => window.selectChanges);
      await page.locator('[data-select-id=selectMask]').click(); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => window.selectChanges), before + 1);
    });
    await test('popup viewport avoidance and layouts at 1000/1440/1627px, 75/100/150% UI scale', async () => {
      for (const width of [1000, 1440, 1627]) for (const scale of [0.75, 1, 1.5]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(scale => { document.body.style.zoom = scale; resizeCanvases(); }, scale);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow ' + width + '/' + scale);
        await page.locator('#menuOption > button').click(); await bounds(page, '#menuOption > .dropdown');
        await page.locator('#subLanguage > button').click(); await bounds(page, '#subLanguage > .dropdown');
        await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
        await page.locator('[data-select-id=selectMask]').click(); await bounds(page, '#selectPopup');
        await page.screenshot({ path: path.join(artifacts, 'github-' + width + '-' + scale + '.png') });
        await page.keyboard.press('Escape');
      }
      await page.evaluate(() => { document.body.style.zoom = 1; resizeCanvases(); }); await page.setViewportSize({ width: 1440, height: 1000 });
    });
    await test('storage unavailable still starts with functional menus and selection panels', async () => {
      const blocked = await browser.newContext();
      await blocked.addInitScript(() => { for (const method of ['getItem', 'setItem', 'removeItem']) Storage.prototype[method] = () => { throw new DOMException('Unavailable', 'SecurityError'); }; });
      const p = await blocked.newPage(); p.on('pageerror', error => errors.push(error.message)); await p.goto(url); await p.locator('#disclaimerClose').click();
      assert.equal(await p.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(13, 17, 23)');
      await p.locator('#menuOption > button').click(); assert.ok(await p.locator('#menuOption > .dropdown').isVisible());
      await p.keyboard.press('Escape'); await p.evaluate(() => setProcessingMode('color', false));
      await p.locator('[data-select-id=selectMask]').click(); await p.keyboard.press('End'); await p.keyboard.press('Enter');
      assert.equal(await p.locator('#selectMask').inputValue(), 'purple'); await blocked.close();
    });
    await test('button hover/pressed/focus/disabled states and menu checkbox keyboard action', async () => {
      await page.evaluate(() => { setGroupOpen('groupActions', true, false); setExportControlsEnabled(true); });
      const button = page.locator('#btnExport');
      await button.hover(); await page.waitForFunction(() => getComputedStyle(el('#btnExport')).backgroundColor === 'rgb(41, 144, 59)');
      await page.mouse.down(); await page.waitForFunction(() => getComputedStyle(el('#btnExport')).backgroundColor === 'rgb(28, 110, 46)');
      await page.mouse.move(1, 1); await page.mouse.up();
      await page.evaluate(() => setExportControlsEnabled(false)); await button.hover();
      await page.waitForFunction(() => getComputedStyle(el('#btnExport')).backgroundColor === 'rgb(22, 27, 34)');
      await page.locator('#menuOption > button').click(); await page.locator('#chkEdaImportProtection').focus();
      const before = await page.locator('#chkEdaImportProtection').isChecked();
      await page.keyboard.press('Enter'); assert.equal(await page.locator('#chkEdaImportProtection').isChecked(), !before);
      assert.equal(await page.locator('#menuOption > .dropdown').isVisible(), false);
      await page.locator('#menuOption > button').focus(); await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineColor), 'rgb(31, 111, 235)');
      await page.keyboard.press('Escape'); await page.evaluate(() => setExportControlsEnabled(true));
    });
    await test('project roundtrip and preview/paint/crop hints use UI palette only', async () => {
      const result = await page.evaluate(async () => {
        const args = buildNativeProjectArgs(), expected = serializeRegions();
        const png = new Uint8Array(await (await canvasPngBlob(state.originCanvas)).arrayBuffer());
        const zip = await createProjectZip([{ name: 'source.png', data: png }, { name: 'args.json', data: new TextEncoder().encode(JSON.stringify(args)) }]);
        resetRegions(); await importNativeProjectFile(new File([zip], 'roundtrip.pcblg'));
        return { expected, actual: serializeRegions(), colors: uiCanvasColors() };
      });
      assert.deepEqual(result.actual, result.expected);
      assert.equal(result.colors.background, '#0d1117'); assert.deepEqual(result.colors.selection, [68, 147, 248]);
      await page.evaluate(() => openPaintEditor());
      assert.equal(await page.locator('#paintSizeIndicator').evaluate(node => getComputedStyle(node).borderColor), 'rgb(68, 147, 248)');
      await page.keyboard.press('Escape');
    });
    await test('segment corners align at 75/100/150% and buttons share border geometry', async () => {
      for (const zoom of [.75, 1, 1.5]) {
        const geometry = await page.evaluate(zoom => {
          document.body.style.zoom = zoom;
          const frame = el('.mode-switch'), box = frame.getBoundingClientRect(), radius = parseFloat(getComputedStyle(frame).borderRadius) * zoom;
          return [...frame.children].map((button, i) => {
            const b = button.getBoundingClientRect(), r = parseFloat(getComputedStyle(button).borderRadius) * zoom;
            return { dx: Math.abs((i ? box.right - radius : box.left + radius) - (i ? b.right - r : b.left + r)),
              dy: Math.abs(box.top + radius - b.top - r), bottom: Math.abs(box.bottom - radius - b.bottom + r) };
          });
        }, zoom);
        assert.ok(geometry.every(g => g.dx < .6 && g.dy < .6 && g.bottom < .6), JSON.stringify(geometry));
      }
      await page.evaluate(() => document.body.style.zoom = 1);
      for (const mode of ['gray', 'color']) {
        await page.locator('[data-processing-mode=' + mode + ']').click(); await page.locator('.hint').hover();
        await page.waitForFunction(() => getComputedStyle(el('.mode-switch .active')).backgroundColor === 'rgb(35, 134, 54)');
        assert.equal(await page.locator('.mode-switch button:not(.active)').evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
      }
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('button')].filter(node => {
        const css = getComputedStyle(node); return css.borderRadius !== '6px' || css.borderTopWidth !== '1px';
      }).map(node => node.id)), []);
      await page.screenshot({ path: path.join(artifacts, 'aligned-mode-switch.png') });
    });
    assert.deepEqual(errors, [], 'runtime errors');
    console.log(JSON.stringify({ passed, failures, artifacts }));
  } finally { await browser.close(); }
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
