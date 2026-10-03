const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pcblg-regions-'));
const baseline = path.join(temp, 'baseline.html');
fs.writeFileSync(baseline, execFileSync('git', ['show', 'HEAD:PCB_lightgraph_portable.html'], { cwd: root }));
const failures = [];
let passed = 0;

async function source(page, width = 96, height = 64) {
  await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'), image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      image.data[i] = (x * 13 + y * 7) % 256;
      image.data[i + 1] = (x * 3 + y * 19) % 256;
      image.data[i + 2] = (x * 23 + y * 5) % 256;
      image.data[i + 3] = (x + y) % 29 === 0 ? 0 : 255;
    }
    ctx.putImageData(image, 0, 0);
    if (typeof resetRegions === 'function') resetRegions();
    replaceProjectOrigin(image, canvas); setExportControlsEnabled(true);
    if (typeof refreshRegionUI === 'function') refreshRegionUI();
  }, { width, height });
}
async function layers(page) {
  return page.evaluate(() => Object.fromEntries(Object.entries(state.layers).map(([key, image]) => [key, Array.from(image.data)])));
}
async function change(page, id, value, local = false) {
  await page.evaluate(({ id, value, local }) => {
    const input = document.querySelector((local ? '#regionLocal_' : '#') + id + ' input');
    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    updateProcess();
  }, { id, value, local });
}
async function test(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (error) { failures.push(name); console.error('FAIL ' + name + '\n' + error.stack); }
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PCBLG_BROWSER_CHANNEL || 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage(), old = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, 'PCB_lightgraph_portable.html')).href);
    await old.goto(pathToFileURL(baseline).href);
    for (const p of [page, old]) if (await p.locator('#disclaimerClose').isVisible()) await p.locator('#disclaimerClose').click();
    await source(page); await source(old);

    await test('unchanged baseline in gray/color, including edge styles and transparent source pixels', async () => {
      for (const mode of ['gray', 'color']) for (const edge of mode === 'gray' ? ['none'] : ['none', 'stroke', 'enhance', 'metal', 'covered-metal']) {
        for (const p of [page, old]) await p.evaluate(({ mode, edge }) => {
          setProcessingMode(mode, false); masterState.edge = edge !== 'none';
          el('#radioEdgeStroke').checked = edge !== 'enhance'; el('#radioEdgeEnhance').checked = edge === 'enhance';
          el('#chkUseMetal').checked = edge.includes('metal'); el('#chkExposeMetal').checked = edge !== 'covered-metal';
          updateProcess();
        }, { mode, edge });
        assert.deepEqual(await layers(page), await layers(old), mode + '/' + edge);
      }
    });

    await page.evaluate(() => {
      masterState.edge = false; setProcessingMode('gray', false);
      regionState.items = [1, 2].map(id => ({ id, name: '区域 ' + id, offsets: { gray: {}, color: {} },
        spans: Array.from({ length: 20 }, (_, i) => [i + 10, id === 1 ? 8 : 50, id === 1 ? 38 : 80]) }));
      regionState.nextId = 3; regionState.selected = 1; touchRegionMasks(); refreshRegionUI(); updateProcess();
    });
    await test('zero-offset regions match baseline pixel for pixel', async () => {
      for (const mode of ['gray', 'color']) {
        for (const p of [page, old]) await p.evaluate(mode => { masterState.edge = false; setProcessingMode(mode, true); }, mode);
        assert.deepEqual(await layers(page), await layers(old));
      }
      await page.evaluate(() => setProcessingMode('gray', true));
    });
    await test('independent global/region groups, selection visibility and advanced regional controls', async () => {
      for (const mode of ['gray', 'color']) {
        await page.evaluate(mode => { setProcessingMode(mode, false); selectRegion(0); }, mode);
        const global = page.locator(mode === 'gray' ? '#groupGray' : '#groupBasic');
        assert.ok(await global.isVisible());
        assert.equal(await global.locator('.group-header span').last().innerText(), '基础参数：全局');
        assert.equal(await page.locator('#regionalControls').isVisible(), false);
        await page.evaluate(() => selectRegion(2));
        assert.ok(await global.isVisible());
        assert.ok(await page.locator('#regionalControls').isVisible());
        assert.equal(await page.locator('#regionBasicTitle').innerText(), '区域参数：区域 2');
        assert.equal(await global.locator('.region-local').count(), 0);
        assert.equal(await page.locator('#groupRegional input[type=range]:visible').count(), 4);
        if (mode === 'color') {
          await page.evaluate(() => { setGroupOpen('groupBare', true, true); setGroupOpen('groupEdge', true, true); });
          assert.equal(await page.locator('#groupRegional input[type=range]:visible').count(), 9);
          await page.evaluate(() => { setGroupOpen('groupBare', false, true); setGroupOpen('groupEdge', false, true); });
        }
      }
      await page.evaluate(() => { setProcessingMode('gray', false); selectRegion(1); });
    });
    await test('narrow region list has no horizontal overflow with long focused names', async () => {
      await page.setViewportSize({ width: 1000, height: 1000 });
      const original = await page.evaluate(() => regionState.items[0].name);
      await page.evaluate(() => { regionState.items[0].name = '区域名称'.repeat(25); refreshRegionUI(); setGroupOpen('groupRegions', true, false); });
      const choice = page.locator('#regionList .region-choice').nth(1);
      await choice.locator('input').focus(); await choice.hover();
      const geometry = await page.locator('#regionList').evaluate(list => ({
        overflow: getComputedStyle(list).overflowX, width: list.clientWidth, content: list.scrollWidth,
        ellipsis: getComputedStyle(list.querySelectorAll('.region-choice span')[1]).textOverflow
      }));
      assert.equal(geometry.overflow, 'hidden');
      assert.ok(geometry.content <= geometry.width, JSON.stringify(geometry));
      assert.equal(geometry.ellipsis, 'ellipsis');
      await page.evaluate(name => { regionState.items[0].name = name; refreshRegionUI(); }, original);
      await page.setViewportSize({ width: 1440, height: 1000 });
    });
    const unchanged = await layers(page);
    await test('gray local threshold/blur/thickening affect only owned pixels', async () => {
      await change(page, 'sliderGraySilk', 190, true);
      await change(page, 'sliderGrayBlur', 1.2, true);
      await change(page, 'sliderGrayThick', 2, true);
      const result = await layers(page); let changed = 0;
      for (const key of Object.keys(result)) for (let i = 0; i < result[key].length; i++) {
        const px = Math.floor(i / 4), x = px % 96, y = Math.floor(px / 96);
        if (x >= 8 && x < 38 && y >= 10 && y < 30) changed += result[key][i] !== unchanged[key][i];
        else assert.equal(result[key][i], unchanged[key][i], key + ':' + i);
      }
      assert.ok(changed > 0);
      assert.equal(await page.evaluate(() => {
        const expected = processGrayLayers(state.origin, regionParameters(state.gray, selectedRegion(), 'gray'));
        const map = { Top_Copper: expected.copper, Top_Mask: expected.mask, Top_Silk: expected.silk };
        for (const [y, start, end] of selectedRegion().spans) for (let x = start; x < end; x++) for (const key in map) {
          const i = (y * state.origin.width + x) * 4;
          for (let c = 0; c < 4; c++) if (state.layers[key].data[i + c] !== map[key].data[i + c]) return false;
        }
        return true;
      }), true, 'regional blur/thickening must use full source context');
    });
    await test('clamp retains offset; global round trip restores local position and baseline dot', async () => {
      await change(page, 'sliderGraySilk', 240); await change(page, 'sliderGraySilk', 255, true);
      await change(page, 'sliderGraySilk', 250);
      assert.deepEqual(await page.evaluate(() => ({ delta: selectedRegion().offsets.gray.silkThreshold,
        local: Number(el('#regionLocal_sliderGraySilk input').value) })), { delta: 15, local: 255 });
      await change(page, 'sliderGraySilk', 200);
      assert.equal(await page.locator('#regionLocal_sliderGraySilk input').inputValue(), '215');
      const dot = await page.evaluate(() => {
        const track = el('#regionLocal_sliderGraySilk .region-slider-track').getBoundingClientRect();
        const point = el('#regionLocal_sliderGraySilk .region-baseline').getBoundingClientRect();
        return { actual: point.x + point.width / 2 - track.x, expected: 8 + (track.width - 16) * 200 / 255 };
      });
      assert.ok(Math.abs(dot.actual - dot.expected) < 1);
      await change(page, 'sliderGraySilk', 210, true);
      assert.equal(await page.evaluate(() => selectedRegion().offsets.gray.silkThreshold), 10);
    });
    await test('global and local slider gestures undo/redo atomically; keyboard history restores old global', async () => {
      const before = await page.locator('#sliderGraySilk input').first().inputValue();
      await change(page, 'sliderGraySilk', 170);
      await page.evaluate(() => undoRegionChange(false));
      assert.equal(await page.locator('#sliderGraySilk input').first().inputValue(), before);
      await page.evaluate(() => undoRegionChange(true));
      assert.equal(await page.locator('#sliderGraySilk input').first().inputValue(), '170');
      await page.evaluate(() => { const input = el('#sliderGraySilk input'); input.value = 171;
        input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change')); undoRegionChange(false); });
      assert.equal(await page.locator('#sliderGraySilk input').first().inputValue(), '170');
    });
    await test('baseline dot stays centered, track-sized and thumb-colored across UI zoom settings', async () => {
      for (const zoom of [.75, 1, 1.5]) {
        const geometry = await page.evaluate(zoom => {
          document.body.style.zoom = zoom;
          const track = el('#regionLocal_sliderGraySilk .region-slider-track').getBoundingClientRect();
          const marker = el('#regionLocal_sliderGraySilk .region-baseline'), dot = marker.getBoundingClientRect();
          const slider = el('#regionLocal_sliderGraySilk input').getBoundingClientRect();
          return { dx: Math.abs(dot.x + dot.width / 2 - track.x - (8 * zoom + (track.width - 16 * zoom) * sliderVal('#sliderGraySilk') / 255)),
            dy: Math.abs(dot.y + dot.height / 2 - slider.y - slider.height / 2),
            diameter: dot.width, thickness: slider.height, color: getComputedStyle(marker).backgroundColor,
            pointerEvents: getComputedStyle(marker).pointerEvents };
        }, zoom);
        assert.ok(geometry.dx < 1 && geometry.dy < 1, JSON.stringify(geometry));
        assert.ok(Math.abs(geometry.diameter - geometry.thickness) < .1);
        assert.equal(geometry.color, 'rgb(31, 111, 235)');
        assert.equal(geometry.pointerEvents, 'none');
      }
      await page.evaluate(() => document.body.style.zoom = 1);
    });
    await test('color region and edge thresholds preserve all pixels outside that region', async () => {
      await page.evaluate(() => { setProcessingMode('color', false); masterState.edge = true;
        el('#chkUseMetal').checked = true; el('#chkExposeMetal').checked = true; updateProcess(); });
      const before = await layers(page);
      await change(page, 'sliderGold', 130, true); await change(page, 'sliderSilk', 70, true);
      await change(page, 'sliderEdgeThresh', 200, true); await change(page, 'sliderEdgeThreshMax', 230, true);
      const after = await layers(page); let changed = 0;
      for (const key of Object.keys(after)) for (let i = 0; i < after[key].length; i++) {
        const px = Math.floor(i / 4), x = px % 96, y = Math.floor(px / 96);
        if (x >= 8 && x < 38 && y >= 10 && y < 30) changed += after[key][i] !== before[key][i];
        else assert.equal(after[key][i], before[key][i]);
      }
      assert.ok(changed > 0);
    });
    await test('mode switches retain independent offsets and masks', async () => {
      const saved = await page.evaluate(() => serializeRegions());
      await page.evaluate(() => { setProcessingMode('gray', true); setProcessingMode('color', true); });
      assert.deepEqual(await page.evaluate(() => serializeRegions()), saved);
    });
    await test('region highlight does not change layers, PNG exports or LED reference', async () => {
      const result = await page.evaluate(async () => {
        const bytes = async () => Array.from(new Uint8Array(await (await layerToPngBlob(state.layers.Top_Silk, true, false)).arrayBuffer()));
        const ledBytes = async () => Array.from(new Uint8Array(await (await ledReferenceToPngBlob(state.origin.width, state.origin.height, state.light.strips)).arrayBuffer()));
        const ledBefore = await ledBytes(); const before = await bytes(); el('#regionHighlight').checked = false; el('#regionHighlight').dispatchEvent(new Event('change'));
        const after = await bytes(); el('#regionHighlight').checked = true; el('#regionHighlight').dispatchEvent(new Event('change'));
        return { before, after, ledBefore, ledAfter: await ledBytes() };
      });
      assert.deepEqual(result.before, result.after);
      assert.deepEqual(result.ledBefore, result.ledAfter);
    });
    await test('downloaded PNG matches authoritative regional production pixels', async () => {
      await page.evaluate(() => { exportCompatibility.edaImportProtection = false; el('#selectExportLayer').value = 'Top_Silk'; });
      const expected = await page.evaluate(() => Array.from(state.layers.Top_Silk.data));
      const downloadPromise = page.waitForEvent('download'); await page.locator('#btnExportSelected').click();
      const download = await downloadPromise, target = path.join(temp, download.suggestedFilename());
      await download.saveAs(target); const png = PNG.sync.read(fs.readFileSync(target));
      assert.equal(png.width, 96); assert.equal(png.height, 64); assert.deepEqual(Array.from(png.data), expected);
    });
    await test('copy/rename labels and delete confirmation cancel/confirm/undo', async () => {
      for (const [id, text] of Object.entries({ regionRename: '重命名此选区', regionClear: '重置局部调整', regionCopy: '复制局部调整至' })) {
        assert.equal(await page.locator('#' + id).innerText(), text);
      }
      assert.equal(await page.locator('#groupRegions .group-header span').last().innerText(), '区域选择/编辑');
      await page.evaluate(() => { selectRegion(1); openRegionCopy(); });
      await page.locator('#regionCopyTargets input').check(); await page.locator('#regionCopySave').click();
      assert.deepEqual(await page.evaluate(() => regionState.items[1].offsets.color), await page.evaluate(() => regionState.items[0].offsets.color));
      await page.evaluate(() => openRegionRename()); await page.locator('#regionName').fill('<eyes>');
      await page.locator('#regionNameSave').click(); assert.ok((await page.locator('#regionList').innerText()).includes('<eyes>'));
      const before = await page.evaluate(() => ({ snapshot: JSON.stringify(captureRegionSnapshot()), history: regionState.undo.length }));
      const production = await layers(page);
      await page.evaluate(() => el('#regionDelete').click());
      assert.equal(await page.locator('#regionDeleteConfirm p').innerText(), '是否删除区域选择并将参数重置为全局？');
      assert.equal(await page.locator('#regionDeleteYes').innerText(), '是');
      assert.equal(await page.locator('#regionDeleteNo').innerText(), '否');
      assert.deepEqual(await page.evaluate(() => ({ no: getComputedStyle(el('#regionDeleteNo')).backgroundColor,
        yes: getComputedStyle(el('#regionDeleteYes')).backgroundColor, focus: document.activeElement.id })),
        { no: 'rgb(33, 40, 48)', yes: 'rgb(218, 54, 51)', focus: 'regionDeleteNo' });
      await page.screenshot({ path: path.join(temp, 'delete-confirmation.png') });
      await page.locator('#regionDeleteNo').click();
      assert.deepEqual(await page.evaluate(() => ({ snapshot: JSON.stringify(captureRegionSnapshot()), history: regionState.undo.length })), before);
      await page.evaluate(() => el('#regionDelete').click()); await page.keyboard.press('Escape');
      assert.equal(await page.locator('#modalBack').evaluate(back => back.classList.contains('show')), false);
      assert.deepEqual(await page.evaluate(() => ({ snapshot: JSON.stringify(captureRegionSnapshot()), history: regionState.undo.length })), before);
      await page.evaluate(() => el('#regionDelete').click()); await page.locator('#regionDeleteYes').click();
      assert.equal(await page.evaluate(() => regionState.items.length), 1);
      assert.equal(await page.evaluate(() => regionState.undo.length), before.history + 1);
      await page.evaluate(() => undoRegionChange(false)); assert.equal(await page.evaluate(() => regionState.items.length), 2);
      assert.deepEqual(await layers(page), production);
    });
    await test('native pcblg ZIP roundtrip and damaged-region import preserve the current project', async () => {
      const result = await page.evaluate(async () => {
        const args = buildNativeProjectArgs(), expected = serializeRegions();
        const png = new Uint8Array(await (await canvasPngBlob(state.originCanvas)).arrayBuffer());
        const zip = await createProjectZip([{ name: 'source.png', data: png }, { name: 'args.json', data: new TextEncoder().encode(JSON.stringify(args)) }]);
        resetRegions(); await importNativeProjectFile(new File([zip], 'roundtrip.pcblg'));
        const actual = serializeRegions(), before = JSON.stringify(captureRegionSnapshot()); let rejected = false;
        const bad = JSON.parse(JSON.stringify(actual)); bad.items[1].spans = [...bad.items[0].spans];
        try { applyImportedProject({ image: { origin: state.origin, canvas: state.originCanvas }, controls: args.portable.controls, regions: bad }); }
        catch (_) { rejected = true; }
        return { expected, actual, version: args.portable.schemaVersion, rejected, retained: before === JSON.stringify(captureRegionSnapshot()) };
      });
      assert.equal(result.version, 5); assert.deepEqual(result.actual, result.expected);
      assert.ok(result.rejected && result.retained);
    });
    await test('out-of-bounds/non-finite offsets and malformed spans are rejected', async () => {
      assert.equal(await page.evaluate(() => {
        const cases = [d => d.items[0].offsets.gray.silkThreshold = Infinity,
          d => d.items[0].spans[0][0] = -1, d => d.items[0].spans[0][2] = state.origin.width + 1,
          d => d.items[0].id = d.items[1].id, d => d.items[0].offsets.color.unknown = 1];
        return cases.every(mutate => { const d = JSON.parse(JSON.stringify(serializeRegions())); mutate(d);
          try { validateRegions(d, state.origin); return false; } catch (_) { return true; } });
      }), true);
    });
    await test('old/native and legacy JSON projects load without regions', async () => {
      await page.evaluate(async () => {
        const args = buildNativeProjectArgs(); delete args.portable.regions; args.portable.schemaVersion = 4;
        applyImportedProject({ image: { origin: state.origin, canvas: state.originCanvas }, controls: args.portable.controls });
        await importLegacyProjectFile(new File([JSON.stringify({ controls: gatherControls(), image: state.originCanvas.toDataURL(),
          experimental: projectExperimentalSettings(), ledStrips: state.light.strips })], 'legacy.pcblg.json'));
      });
      assert.equal(await page.evaluate(() => regionState.items.length), 0);
    });
    await test('lower bound preserves negative offset; fractional sliders retain their original step', async () => {
      await page.evaluate(() => {
        regionState.items = [{ id: 1, name: 'Low', spans: [[2, 2, 12]], offsets: { gray: {}, color: {} } }];
        regionState.selected = 1; touchRegionMasks(); refreshRegionUI(); setProcessingMode('gray', true);
      });
      await change(page, 'sliderGraySilk', 15); await change(page, 'sliderGraySilk', 0, true);
      await change(page, 'sliderGraySilk', 5);
      assert.equal(await page.locator('#regionLocal_sliderGraySilk input').inputValue(), '0');
      await change(page, 'sliderGraySilk', 30);
      assert.equal(await page.locator('#regionLocal_sliderGraySilk input').inputValue(), '15');
      await change(page, 'sliderGrayThick', 1.2); await change(page, 'sliderGrayThick', 2.6, true);
      await change(page, 'sliderGrayThick', 2);
      assert.equal(await page.locator('#regionLocal_sliderGrayThick input').inputValue(), '3.4');
      await page.evaluate(() => resetAllSettings());
    });

    await source(page, 256, 192);
    await page.evaluate(() => { masterState.light = false; masterState.edge = false; setProcessingMode('gray', true); setGroupOpen('groupRegions', true, false); });
    async function imagePoint(x, y) {
      return page.evaluate(({ x, y }) => {
        const canvas = el('#canvasComposite'), b = canvas.getBoundingClientRect(), st = previewStates.composite;
        const rect = calcPreviewRect(canvas.width, canvas.height, state.origin.width, state.origin.height, st.zoom, st.pan);
        return { x: b.x + (rect.x + x / state.origin.width * rect.w) * b.width / canvas.width,
          y: b.y + (rect.y + y / state.origin.height * rect.h) * b.height / canvas.height };
      }, { x, y });
    }
    async function gesture(tool, operation, points) {
      if (await page.evaluate(() => regionState.tool) !== tool) await page.locator('[data-region-tool=' + tool + ']').click();
      await page.locator('[data-region-operation=' + operation + ']').click();
      const first = await imagePoint(...points[0]); await page.mouse.move(first.x, first.y); await page.mouse.down();
      for (const p of points.slice(1)) { const target = await imagePoint(...p); await page.mouse.move(target.x, target.y, { steps: 4 }); }
      await page.mouse.up();
    }
    await test('three selection tools toggle off without a separate Select button', async () => {
      assert.equal(await page.locator('[data-region-tool=none]').count(), 0);
      assert.equal(await page.locator('[data-region-tool]').count(), 3);
      for (const tool of ['rect', 'lasso', 'brush']) {
        const button = page.locator('[data-region-tool=' + tool + ']');
        await button.click(); assert.equal(await page.evaluate(() => regionState.tool), tool);
        await button.click(); assert.equal(await page.evaluate(() => regionState.tool), 'none');
        assert.equal(await page.locator('#regionTools .active').count(), 0);
      }
    });
    await test('real rectangle/lasso/brush gestures, exclusion, range edits and empty subtract undo', async () => {
      await gesture('rect', 'new', [[20, 20], [90, 80]]);
      await gesture('lasso', 'new', [[60, 40], [160, 40], [160, 110], [60, 110], [60, 40]]);
      assert.equal(await page.evaluate(() => regionState.items.length), 2);
      assert.equal(await page.evaluate(() => validateRegions(serializeRegions(), state.origin).length), 2);
      const oldSpans = await page.evaluate(() => JSON.stringify(regionState.items[0].spans));
      await gesture('brush', 'add', [[180, 140], [205, 150]]);
      assert.equal(await page.evaluate(() => JSON.stringify(regionState.items[0].spans)), oldSpans);
      await gesture('rect', 'subtract', [[0, 0], [255, 191]]);
      assert.equal(await page.evaluate(() => regionState.items.length), 1);
      await page.evaluate(() => undoRegionChange(false)); assert.equal(await page.evaluate(() => regionState.items.length), 2);
    });
    await test('zoom/pan keep selection coordinates; disabled tool restores LED placement', async () => {
      const canvas = page.locator('#canvasComposite'), b = await canvas.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.wheel(0, -240);
      await page.mouse.down({ button: 'right' }); await page.mouse.move(b.x + b.width / 2 + 30, b.y + b.height / 2 + 15); await page.mouse.up({ button: 'right' });
      await gesture('rect', 'new', [[210, 25], [235, 50]]);
      assert.equal(await page.evaluate(() => regionState.items.length), 3);
      assert.equal(await page.evaluate(() => regionOwners(256, 192)[35 * 256 + 220]), 3);
      await page.locator('#regionTools .active').click();
      await page.evaluate(() => { setProcessingMode('color', true); setGroupOpen('groupLight', true, true); });
      const a = await imagePoint(25, 25), c = await imagePoint(70, 70);
      await page.mouse.click(a.x, a.y); await page.mouse.click(c.x, c.y);
      assert.equal(await page.evaluate(() => state.light.strips.length), 1);
    });
    await test('quick paint preserves region masks; four views and all UI languages render', async () => {
      const masks = await page.evaluate(() => serializeRegions());
      await page.evaluate(() => { openPaintEditor(); paintSession.ctx.fillStyle = '#fff'; paintSession.ctx.fillRect(0, 0, 8, 8); paintApplyToProject(); closeModal(); });
      assert.deepEqual(await page.evaluate(() => serializeRegions()), masks);
      for (const language of ['zh-CN', 'zh-TW', 'en', 'ja']) for (const view of ['overlay', 'split', 'quad']) {
        await page.evaluate(({ language, view }) => { setLanguage(language, false); setViewMode(view); }, { language, view });
        assert.ok(await page.locator('#regionBasicTitle').innerText());
      }
      await page.evaluate(() => { setLanguage('zh-CN', false); setViewMode('overlay'); selectRegion(1); setGroupOpen('groupLight', false, true); });
      await page.screenshot({ path: path.join(temp, 'regions-ui.png') });
    });
    await test('real native local/global slider drags move the baseline and preserve isolation', async () => {
      await page.evaluate(() => { setProcessingMode('gray', true); selectRegion(1); });
      async function drag(selector, fraction) {
        const locator = page.locator(selector); await locator.scrollIntoViewIfNeeded(); const b = await locator.boundingBox();
        await page.mouse.move(b.x + 8 + (b.width - 16) * fraction, b.y + b.height / 2);
        await page.mouse.down(); await page.mouse.move(b.x + 8 + (b.width - 16) * fraction + 2, b.y + b.height / 2); await page.mouse.up();
        await page.waitForFunction(() => state.fullResGeneration === prc.generation);
      }
      const before = await page.evaluate(() => JSON.stringify(regionState.items[1].offsets));
      await drag('#regionLocal_sliderGraySilk input', .75);
      assert.equal(await page.evaluate(() => JSON.stringify(regionState.items[1].offsets)), before);
      const delta = await page.evaluate(() => selectedRegion().offsets.gray.silkThreshold);
      await drag('#sliderGraySilk > .ctl > input', .6);
      assert.equal(await page.evaluate(() => selectedRegion().offsets.gray.silkThreshold), delta);
      assert.equal(await page.evaluate(() => Number(el('#regionLocal_sliderGraySilk input').value)),
        await page.evaluate(() => clamp(sliderVal('#sliderGraySilk') + selectedRegion().offsets.gray.silkThreshold, 0, 255)));
    });
    await test('brush creates new region; selecting fully occupied pixels is a no-op', async () => {
      await gesture('brush', 'new', [[170, 160], [180, 170]]);
      const before = await page.evaluate(() => ({ count: regionState.items.length, history: regionState.undo.length }));
      await gesture('rect', 'new', [[30, 30], [60, 60]]);
      assert.deepEqual(await page.evaluate(() => ({ count: regionState.items.length, history: regionState.undo.length })), before);
    });
    await test('history is limited to 50 steps and redo restores numeric values', async () => {
      await page.evaluate(() => {
        for (let i = 0; i < 60; i++) { const input = el('#sliderGraySilk input'); input.value = 40 + i;
          input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change')); }
      });
      assert.equal(await page.evaluate(() => regionState.undo.length), 50);
      await page.evaluate(() => { for (let i = 0; i < 50; i++) undoRegionChange(false); });
      assert.equal(await page.locator('#sliderGraySilk input').first().inputValue(), '49');
      await page.evaluate(() => { for (let i = 0; i < 50; i++) undoRegionChange(true); });
      assert.equal(await page.locator('#sliderGraySilk input').first().inputValue(), '99');
    });
    await test('reset keeps masks and clears offsets; new image clears regions and history', async () => {
      const before = await page.evaluate(() => regionState.items.map(item => item.spans));
      await page.evaluate(() => resetAllSettings());
      assert.deepEqual(await page.evaluate(() => regionState.items.map(item => item.spans)), before);
      assert.equal(await page.evaluate(() => regionState.items.every(item => !Object.keys(item.offsets.gray).length && !Object.keys(item.offsets.color).length)), true);
      await page.evaluate(() => { importDecodedImage(state.originCanvas, { x: 0, y: 0, w: 128, h: 128 }); });
      assert.equal(await page.evaluate(() => regionState.items.length + regionState.undo.length + regionState.redo.length), 0);
    });
    await test('zoomed highlight and live gestures match original pixels beyond 800px', async () => {
      await source(page, 1200, 900);
      const result = await page.evaluate(() => {
        regionState.items = [{ id: 1, name: '原图像素边界', offsets: { gray: {}, color: {} }, spans: [
          ...Array.from({ length: 40 }, (_, y) => [430 + y, 580 + y, 583 + y]),
          ...Array.from({ length: 6 }, (_, y) => [473 + y, 540, 675])
        ] }];
        regionState.nextId = 2; regionState.selected = 1; regionState.highlight = true; touchRegionMasks();
        const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 180;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const rect = { x: -1100, y: -820, w: 2400, h: 1800 };
        drawRegionOverlay(ctx, rect);
        const pixels = ctx.getImageData(0, 0, 240, 180).data, owners = regionOwners(1200, 900);
        let highlighted = 0, mismatch = 0;
        for (let y = 0; y < 180; y++) for (let x = 0; x < 240; x++) {
          const sourceX = 550 + Math.floor(x / 2), sourceY = 410 + Math.floor(y / 2), p = sourceY * 1200 + sourceX;
          const edge = [p - 1, p + 1, p - 1200, p + 1200].some(i => owners[i] !== 1);
          const expected = owners[p] === 1 ? (edge ? 220 : 42) : 0;
          if (expected) highlighted++;
          if (pixels[(y * 240 + x) * 4 + 3] !== expected) mismatch++;
        }
        const cacheSize = regionState.overlayCache.canvas.width * regionState.overlayCache.canvas.height;
        const gestures = [
          { tool: 'rect', points: [{ x: 556.1, y: 418.2 }, { x: 573.8, y: 429.7 }] },
          { tool: 'lasso', points: [{ x: 600.4, y: 452.3 }, { x: 630.7, y: 454.4 }, { x: 624.1, y: 470.8 }] },
          { tool: 'brush', size: 1, points: [{ x: 650.5, y: 482.5 }, { x: 659.5, y: 489.5 }] }
        ];
        let gestureMismatch = 0, candidates = 0;
        for (const gesture of gestures) {
          regionState.highlight = false; regionState.gesture = { operation: 'new', size: 24, pointerId: 999, ...gesture };
          ctx.clearRect(0, 0, 240, 180); drawRegionOverlay(ctx, rect);
          const preview = ctx.getImageData(0, 0, 240, 180).data;
          finishRegionGesture(false); const final = regionOwners(1200, 900), id = regionState.selected;
          for (let y = 0; y < 180; y++) for (let x = 0; x < 240; x++) {
            const included = preview[(y * 240 + x) * 4 + 3] > 0;
            const saved = final[(410 + Math.floor(y / 2)) * 1200 + 550 + Math.floor(x / 2)] === id;
            candidates += included;
            if (included !== saved) gestureMismatch++;
          }
        }
        regionState.highlight = true; selectRegion(1); previewStates.composite.zoom = 6; renderAllPreviews();
        return { mismatch, highlighted, cacheSize, gestureMismatch, candidates };
      });
      assert.equal(result.mismatch, 0, 'highlight must follow each original pixel, without viewport seam edges');
      assert.equal(result.gestureMismatch, 0, 'live preview and saved selection must agree');
      assert.ok(result.highlighted > 0 && result.candidates > 0);
      assert.ok(result.cacheSize < 15000, 'zoomed overlay caches only the visible source crop');
      await page.screenshot({ path: path.join(temp, 'original-pixel-highlight.png') });
    });
    await test('near-limit image: progressive render, full-res export, bounded caches and history', async () => {
      await source(page, 4000, 3999);
      const timing = await page.evaluate(() => {
        setProcessingMode('gray', false); state.gray.thickRadius = 0; state.gray.blurRadius = 0;
        setSlider('#sliderGrayThick', 0); setSlider('#sliderGrayBlur', 0);
        regionState.items = [1, 2, 3].map(id => ({ id, name: 'Region ' + id, offsets: { gray: { silkThreshold: id * 15 }, color: {} },
          spans: Array.from({ length: 80 }, (_, i) => [i + 100 * id, 100, 240]) }));
        touchRegionMasks(); prcInvalidate(); const start = performance.now();
        renderAtSize(500, 499, prc.generation, false); const interactive = performance.now() - start;
        getExportSettings(); const full = performance.now() - start - interactive;
        return { interactive, full, width: state.layers.Top_Silk.width, owners: regionState.ownerCache.data.length,
          previewCacheCount: regionState.previewOwnerCache ? 1 : 0 };
      });
      assert.equal(timing.width, 4000); assert.equal(timing.owners, 15996000); assert.ok(timing.previewCacheCount <= 1);
      console.log('PERF ' + JSON.stringify(timing));
      await source(page, 32, 32);
      assert.equal(await page.evaluate(() => regionState.ownerCache), null);
    });
    assert.deepEqual(errors, [], 'browser runtime errors');
    console.log(JSON.stringify({ passed, failures, artifacts: temp }));
  } finally { await browser.close(); }
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
