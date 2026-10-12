import {generatorAssetUrl} from './assetUrl';
import { E1Options, PassCardInfo, PreviewKind, LayerVisibilityConfig } from '../types';
import { getFactionEnText, getProfessionEnText } from '../data/defaultCharacters';
import { drawBarcode } from './barcode';

export const CARD_WIDTH = 590;
export const CARD_HEIGHT = 1180;

// Asset Cache for PSD images
const imageCache: Map<string, HTMLImageElement | null> = new Map();
let backInnerBorderTemplate: HTMLCanvasElement | null = null;
let backInnerBorderTemplatePromise: Promise<HTMLCanvasElement | null> | null = null;

import { PSD_ASSETS } from '../data/imageAssets';

/**
 * Safely check if an HTMLImageElement is valid and ready to draw
 */
export function isImageValid(img: HTMLImageElement | null | undefined): img is HTMLImageElement {
  return !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
}

/**
 * Load image from URL or Data URL asynchronously with caching
 */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }

    let actualSrc = src;
    if (src.includes('psd_assets/')) {
      const parts = src.split('/');
      const filename = parts[parts.length - 1];
      if (PSD_ASSETS[filename]) {
        actualSrc = PSD_ASSETS[filename];
      } else {
        const c = document.createElement('canvas');
        c.width = 100;
        c.height = 100;
        const cx = c.getContext('2d');
        if (cx) {
          cx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          cx.fillRect(10, 10, 80, 80);
          PSD_ASSETS[filename] = c.toDataURL('image/png');
          actualSrc = PSD_ASSETS[filename];
        }
      }
    }

    if (imageCache.has(actualSrc)) {
      const cached = imageCache.get(actualSrc);
      if (isImageValid(cached)) {
        resolve(cached);
      } else {
        resolve(null);
      }
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        imageCache.set(actualSrc, img);
        if (src !== actualSrc) imageCache.set(src, img);
        resolve(img);
      } else {
        imageCache.set(actualSrc, null);
        if (src !== actualSrc) imageCache.set(src, null);
        resolve(null);
      }
    };
    img.onerror = () => {
      imageCache.set(src, null);
      resolve(null);
    };
    img.src = actualSrc;
  });
}

function getOpaqueBounds(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const data = ctx.getImageData(0, 0, width, height).data;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { minY: minY === height ? 0 : minY, maxY: maxY < 0 ? -1 : maxY };
}

/**
 * Dedicated border template for the back-inner print. The alpha extent of
 * the E1 baseboard is measured at render time, then the original front outer border
 * is clipped asymmetrically before it is used by this layer.
 */
export async function getBackInnerBorderTemplate(): Promise<HTMLCanvasElement | null> {
  if (backInnerBorderTemplate) return backInnerBorderTemplate;
  if (backInnerBorderTemplatePromise) return backInnerBorderTemplatePromise;

  backInnerBorderTemplatePromise = (async () => {
    const [baseboardImg, borderImg] = await Promise.all([
      loadImage('./psd_assets/中间__精一底板.png'),
      loadImage('./psd_assets/正面__装饰图案__饰边.png'),
    ]);
    if (!isImageValid(baseboardImg) || !isImageValid(borderImg)) return null;

    const baseboardCanvas = document.createElement('canvas');
    baseboardCanvas.width = CARD_WIDTH;
    baseboardCanvas.height = 495;
    const baseboardCtx = baseboardCanvas.getContext('2d');
    if (!baseboardCtx) return null;
    baseboardCtx.drawImage(baseboardImg, 0, 0, CARD_WIDTH, 495);
    const bounds = getOpaqueBounds(baseboardCtx, CARD_WIDTH, 495);
    const opaqueHeight = bounds.maxY >= 0 ? bounds.maxY + 1 : 0;
    // The measured height is a distance from the bottom edge. Delete content
    // closer to the bottom than that distance on the left half, and closer
    // than half that distance on the right half.
    const boardBottom = CARD_HEIGHT - opaqueHeight;
    const halfBoardBottom = CARD_HEIGHT - opaqueHeight / 2;

    const template = document.createElement('canvas');
    template.width = CARD_WIDTH;
    template.height = CARD_HEIGHT;
    const templateCtx = template.getContext('2d');
    if (!templateCtx) return null;
    templateCtx.drawImage(borderImg, 0, 0, CARD_WIDTH, CARD_HEIGHT);
    const imageData = templateCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
    const data = imageData.data;
    for (let y = 0; y < CARD_HEIGHT; y++) {
      for (let x = 0; x < CARD_WIDTH; x++) {
        const cut = x < CARD_WIDTH / 2 ? y >= boardBottom : y >= halfBoardBottom;
        if (cut) data[(y * CARD_WIDTH + x) * 4 + 3] = 0;
      }
    }
    templateCtx.putImageData(imageData, 0, 0);
    backInnerBorderTemplate = template;
    return template;
  })();

  return backInnerBorderTemplatePromise;
}

/**
 * Preload all static PSD layer assets
 */
export async function preloadPsdAssets() {
  const assets = [
    './psd_assets/中间__精一底板.png',
    './psd_assets/正面__装饰图案__饰边.png',
    './psd_assets/正面__装饰图案__渐变条纹.png',
    './psd_assets/正面__装饰图案__明日方舟.png',
    './psd_assets/背面__装饰__饰边.png',
    './psd_assets/背面__装饰__渐变条纹.png',
    './psd_assets/背面__文字__商标.png',
    './psd_assets/刀线.png',

    // Profession Icons
    './psd_assets/正面__职业图标__近卫图标.png',
    './psd_assets/正面__职业图标__狙击.png',
    './psd_assets/正面__职业图标__特种.png',
    './psd_assets/正面__职业图标__辅助图标.png',
    './psd_assets/正面__职业图标__重装.png',
    './psd_assets/正面__职业图标__先锋.png',
    './psd_assets/正面__职业图标__医疗.png',
    './psd_assets/正面__职业图标__术士.png',

    // Barcode assets
    './psd_assets/正面__文字__generated_barcode.png',
    './psd_assets/正面__文字__ARKNIGHTS_-_R001_.png',
    './psd_assets/背面__generated_barcode.png',
    './psd_assets/背面__文字__ARKNIGHTS_-_MN04.png',
    './psd_assets/背面__装饰__条码.png',

    // Faction Watermark Icons
    './psd_assets/中间__阵营图标__罗德岛.png',
    './psd_assets/中间__阵营图标__卡西米尔.png',
    './psd_assets/中间__阵营图标__岁.png',
    './psd_assets/中间__阵营图标__炎.png',
    './psd_assets/中间__阵营图标__莱茵生命.png',
    './psd_assets/中间__阵营图标__使徒.png',
    './psd_assets/中间__阵营图标__深海猎人.png',
    './psd_assets/中间__阵营图标__萨米.png',
    './psd_assets/中间__阵营图标__汐斯塔.png',
    './psd_assets/中间__阵营图标__拉特兰.png',
    './psd_assets/中间__阵营图标__莱塔尼亚.png',
    './psd_assets/中间__阵营图标__萨尔贡.png',
    './psd_assets/中间__阵营图标__企鹅物流.png',
    './psd_assets/中间__阵营图标__黑钢国际.png',
    './psd_assets/中间__阵营图标__鲤氏.png',
    './psd_assets/中间__阵营图标__东国.png',
    './psd_assets/中间__阵营图标__sweep.png',
    './psd_assets/中间__阵营图标__叙拉古.png',
    './psd_assets/中间__阵营图标__雷姆必拓.png',
    './psd_assets/中间__阵营图标__维多利亚.png',
    './psd_assets/中间__阵营图标__哥伦比亚.png',
    './psd_assets/中间__阵营图标__喀兰贸易.png',
    './psd_assets/中间__阵营图标__乌萨斯.png',
    './psd_assets/中间__阵营图标__龙门近卫局.png',
  ];

  await Promise.all(assets.map(url => loadImage(url)));

  // Ensure OTF fonts from /fonts are loaded for Canvas rendering
  await ensureFontsLoaded();
}

// 字体加载完成后派发的全局事件（供预览组件监听后立即重绘）
export const FONTS_LOADED_EVENT = 'pass:fonts-loaded';

let fontsLoaded = false;
let fontsLoadedPromise: Promise<void> | null = null;

/**
 * 确保 4 个自定义 OTF 字体已注册到 document.fonts。
 * 加载完成后派发 FONTS_LOADED_EVENT，预览组件监听该事件刷新画布中的文字。
 */
export function ensureFontsLoaded(): Promise<void> {
  if (fontsLoadedPromise) return fontsLoadedPromise;
  fontsLoadedPromise = (async () => {
    // 场景1：非浏览器环境（document 不存在），无字体可加载，直接标记完成
    if (typeof document === 'undefined') {
      fontsLoaded = true;
      return;
    }

    // 场景2：浏览器环境但 FontFace 构造器不可用，退化为 document.fonts.load 后备方式
    if (typeof FontFace === 'undefined') {
      try {
        await Promise.all([
          document.fonts.load('85px "BebasNeue"'),
          document.fonts.load('17px "NotoSansHans-Bold"'),
          document.fonts.load('16px "AdobeHeitiStd"'),
          document.fonts.load('16px "NotoSansHans-Medium"'),
        ]);
        await document.fonts.ready;
      } catch (err) {
        console.warn('Font loading notice:', err);
      }
      fontsLoaded = true;
      return;
    }

    // 场景3：正常浏览器环境，用 FontFace 构造并注册
    try {
      const fontsList = Array.from(document.fonts.values());
      const loadIfMissing = async (family: string, src: string, options?: FontFaceDescriptors) => {
        if (fontsList.some(f => f.family === family)) return;
        const face = new FontFace(family, src, options);
        const loaded = await face.load();
        document.fonts.add(loaded);
      };
      await Promise.all([
        loadIfMissing('BebasNeue', `url(${generatorAssetUrl('fonts/BebasNeue-Regular.otf')})`),
        loadIfMissing('NotoSansHans-Bold', `url(${generatorAssetUrl('fonts/NotoSansHans-Bold.otf')})`, { weight: 'bold' }),
        loadIfMissing('AdobeHeitiStd', `url(${generatorAssetUrl('fonts/AdobeHeitiStd-Regular.otf')})`),
        loadIfMissing('NotoSansHans-Medium', `url(${generatorAssetUrl('fonts/NotoSansHans-Medium.otf')})`),
      ]);
      await document.fonts.ready;
    } catch (err) {
      console.warn('Programmatic font loading notice:', err);
    }
    fontsLoaded = true;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(FONTS_LOADED_EVENT));
    }
  })();
  return fontsLoadedPromise;
}

/**
 * 判断自定义字体是否已经加载完成
 */
export function areFontsLoaded(): boolean {
  return fontsLoaded;
}

// Convert Hex to RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('');
  }
  const num = parseInt(clean, 16);
  if (isNaN(num)) return { r: 13, g: 27, b: 42 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/**
 * Get Profession Icon URL based on key
 */
function getProfessionIconUrl(prof: string): string {
  let key = '正面__职业图标__近卫图标.png';
  switch (prof) {
    case '近卫': key = '正面__职业图标__近卫图标.png'; break;
    case '狙击': key = '正面__职业图标__狙击.png'; break;
    case '特种': key = '正面__职业图标__特种.png'; break;
    case '辅助': key = '正面__职业图标__辅助图标.png'; break;
    case '重装': key = '正面__职业图标__重装.png'; break;
    case '先锋': key = '正面__职业图标__先锋.png'; break;
    case '医疗': key = '正面__职业图标__医疗.png'; break;
    case '术士':
    case '术师': key = '正面__职业图标__术士.png'; break;
    default: key = '正面__职业图标__近卫图标.png'; break;
  }
  return PSD_ASSETS[key] ?? '';
}

/**
 * Map Faction Name to extracted PSD Faction Icon asset & bounding box
 */
const FACTION_POS_MAP: Record<string, { x: number; y: number; w: number; h: number }> = {
  '罗德岛': { x: 51, y: 642, w: 563, h: 524 },
  '卡西米尔': { x: 228, y: 686, w: 338, h: 484 },
  '岁': { x: 107, y: 684, w: 483, h: 429 },
  '炎': { x: 155, y: 686, w: 420, h: 484 },
  '莱茵生命': { x: 111, y: 846, w: 467, h: 269 },
  '使徒': { x: 181, y: 701, w: 333, h: 479 },
  '深海猎人': { x: 84, y: 730, w: 506, h: 450 },
  '萨米': { x: 159, y: 767, w: 393, h: 393 },
  '汐斯塔': { x: 104, y: 734, w: 471, h: 399 },
  '拉特兰': { x: 117, y: 759, w: 459, h: 421 },
  '莱塔尼亚': { x: 123, y: 780, w: 452, h: 362 },
  '萨尔贡': { x: 121, y: 796, w: 454, h: 375 },
  '企鹅物流': { x: 200, y: 741, w: 302, h: 427 },
  '黑钢国际': { x: 91, y: 810, w: 499, h: 321 },
  '鲤氏': { x: 200, y: 767, w: 288, h: 371 },
  '鲤氏侦探事务所': { x: 200, y: 767, w: 288, h: 371 },
  '东国': { x: 215, y: 768, w: 259, h: 376 },
  'sweep': { x: 200, y: 767, w: 322, h: 348 },
  'SWEEP': { x: 200, y: 767, w: 322, h: 348 },
  '叙拉古': { x: 159, y: 759, w: 369, h: 401 },
  '雷姆必拓': { x: 95, y: 836, w: 495, h: 195 },
  '维多利亚': { x: 117, y: 751, w: 468, h: 365 },
  '哥伦比亚': { x: 145, y: 741, w: 430, h: 415 },
  '喀兰贸易': { x: 164, y: 767, w: 384, h: 383 },
  '乌萨斯': { x: 110, y: 756, w: 480, h: 342 },
  '龙门近卫局': { x: 200, y: 759, w: 273, h: 382 },
  '龙门': { x: 200, y: 759, w: 273, h: 382 },
};

export function getFactionIconPos(factionName: string): { x: number; y: number; w: number; h: number } {
  if (!factionName) return FACTION_POS_MAP['罗德岛'];
  const name = factionName.trim();
  for (const k in FACTION_POS_MAP) {
    if (name.includes(k) || k.includes(name)) {
      return FACTION_POS_MAP[k];
    }
  }
  return FACTION_POS_MAP['罗德岛'];
}

function getFactionIconUrl(factionName: string): string | null {
  if (!factionName) return PSD_ASSETS['中间__阵营图标__罗德岛.png'] ?? null;
  const name = factionName.trim();
  const map: Record<string, string> = {
    '罗德岛': '中间__阵营图标__罗德岛.png',
    '卡西米尔': '中间__阵营图标__卡西米尔.png',
    '岁': '中间__阵营图标__岁.png',
    '炎': '中间__阵营图标__炎.png',
    '莱茵生命': '中间__阵营图标__莱茵生命.png',
    '使徒': '中间__阵营图标__使徒.png',
    '深海猎人': '中间__阵营图标__深海猎人.png',
    '萨米': '中间__阵营图标__萨米.png',
    '汐斯塔': '中间__阵营图标__汐斯塔.png',
    '拉特兰': '中间__阵营图标__拉特兰.png',
    '莱塔尼亚': '中间__阵营图标__莱塔尼亚.png',
    '萨尔贡': '中间__阵营图标__萨尔贡.png',
    '企鹅物流': '中间__阵营图标__企鹅物流.png',
    '黑钢国际': '中间__阵营图标__黑钢国际.png',
    '鲤氏': '中间__阵营图标__鲤氏.png',
    '鲤氏侦探事务所': '中间__阵营图标__鲤氏.png',
    '东国': '中间__阵营图标__东国.png',
    'sweep': '中间__阵营图标__sweep.png',
    'SWEEP': '中间__阵营图标__sweep.png',
    '叙拉古': '中间__阵营图标__叙拉古.png',
    '雷姆必拓': '中间__阵营图标__雷姆必拓.png',
    '维多利亚': '中间__阵营图标__维多利亚.png',
    '哥伦比亚': '中间__阵营图标__哥伦比亚.png',
    '喀兰贸易': '中间__阵营图标__喀兰贸易.png',
    '乌萨斯': '中间__阵营图标__乌萨斯.png',
    '龙门近卫局': '中间__阵营图标__龙门近卫局.png',
    '龙门': '中间__阵营图标__龙门近卫局.png',
  };

  for (const k in map) {
    if (name.includes(k)) {
      const filename = map[k];
      return PSD_ASSETS[filename] ?? PSD_ASSETS['中间__阵营图标__罗德岛.png'] ?? null;
    }
  }
  return PSD_ASSETS['中间__阵营图标__罗德岛.png'] ?? null;
}

/**
 * Draw Vertical Barcode on Left / Right edge
 */
function drawVerticalBarcode(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  barColor: string = '#ffffff'
) {
  let asciiText = text.replace(/[^\x00-\x7F]/g, '').trim();
  if (!asciiText) asciiText = 'ARKNIGHTS - R001';

  // 1. Offscreen horizontal canvas for barcode rendering
  const offCanvas = document.createElement('canvas');
  offCanvas.width = height; // 310
  offCanvas.height = width;  // 55
  const offCtx = offCanvas.getContext('2d');
  if (!offCtx) return;

  offCtx.clearRect(0, 0, height, width);
  drawBarcode(offCtx, asciiText.toUpperCase(), 0, 0, height, width, barColor, false);

  // 2. Rotate 90 degrees clockwise & draw onto main canvas at (x, y)
  ctx.save();
  ctx.translate(x + width, y);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(offCanvas, 0, 0);
  ctx.restore();
}

/**
 * 1. Front Card Renderer (正面) strictly based on 通行证模板傻瓜版含正反面.psd
 */
export async function renderFrontCard(
  ctx: CanvasRenderingContext2D,
  info: PassCardInfo,
  image1Obj?: HTMLImageElement | null,
  e1Opts?: E1Options | null,
  customIconImg?: HTMLImageElement | null,
  layers?: LayerVisibilityConfig,
  cutoutObj?: HTMLImageElement | null,
  applyDiecut: boolean = true,
  variant: 'front' | 'backInner' = 'front'
) {
  ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const isE2 = info.elite_phase === 'E2';
  const baseColor = info.base_color || info.back_color || '#003466';

  // 1. Background Canvas Fill: Dark Slate / Navy background
  if (layers?.background !== false) {
    ctx.fillStyle = '#0a0e17';
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  }

  // The back-inner border is a dedicated, pre-clipped template and must be
  // the lowest layer so the baseboard/photo can cover it.
  if (variant === 'backInner' && layers?.borderOverlay !== false) {
    const borderTemplate = await getBackInnerBorderTemplate();
    if (borderTemplate) ctx.drawImage(borderTemplate, 0, 0);
  }

  // 2. Character Photo Layer (人物层 - 覆盖 590x1180 完整画布，按比例缩放填充，绝无拉伸)
  if (layers?.characterPhoto !== false) {
    if (isImageValid(image1Obj) || isImageValid(cutoutObj)) {
      const activeBase = isImageValid(image1Obj) ? image1Obj : cutoutObj!;
      ctx.save();
      const targetW = CARD_WIDTH;
      const targetH = CARD_HEIGHT;
      const imgRatio = activeBase.width / activeBase.height;
      const targetRatio = targetW / targetH; // 590 / 1180 = 0.5

      let drawW = targetW;
      let drawH = targetH;
      let drawX = 0;
      let drawY = 0;

      if (imgRatio > targetRatio) {
        drawH = targetH;
        drawW = targetH * imgRatio;
        drawX = (targetW - drawW) / 2;
        drawY = 0;
      } else {
        drawW = targetW;
        drawH = targetW / imgRatio;
        drawX = 0;
        drawY = (targetH - drawH) / 2;
      }

      // Draw Base Photo (image1)
      if (isImageValid(image1Obj)) {
        ctx.drawImage(image1Obj, drawX, drawY, drawW, drawH);
      }

      // If cutoutObj is also provided and separate from image1Obj, draw it aligned on top
      if (isImageValid(cutoutObj) && cutoutObj !== image1Obj) {
        ctx.drawImage(cutoutObj, drawX, drawY, drawW, drawH);
      }
      ctx.restore();
    } else {
      // Subtle default placeholder when no photo is uploaded
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.font = '24px "NotoSansHans-Bold", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('请上传干员立绘/照片', CARD_WIDTH / 2, 350);
      ctx.font = '14px "NotoSansHans-Medium", sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillText('(CHARACTER PHOTO AREA)', CARD_WIDTH / 2, 385);
      ctx.restore();
    }
  }

  // In E2 mode, draw a dark subtle gradient overlay at bottom so text stays crisp
  if (isE2 && layers?.background !== false) {
    ctx.save();
    const shadowGrad = ctx.createLinearGradient(0, 600, 0, CARD_HEIGHT);
    shadowGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    shadowGrad.addColorStop(0.4, 'rgba(0, 0, 0, 0.55)');
    shadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0.88)');
    ctx.fillStyle = shadowGrad;
    ctx.fillRect(0, 600, CARD_WIDTH, CARD_HEIGHT - 600);
    ctx.restore();
  }

  // 3. Baseboard Overlay (中间 / 精一底板: pos x: 0, y: 685, w: 590, h: 495)
  // ONLY rendered in E1 mode (E2 hides bottom baseboard)
  // 改为卡面基础色彩 (baseColor) 填充
  if (!isE2 && layers?.baseboard !== false) {
    const baseboardImg = imageCache.get('./psd_assets/中间__精一底板.png') || await loadImage('./psd_assets/中间__精一底板.png');
    if (isImageValid(baseboardImg)) {
      const bbCanvas = document.createElement('canvas');
      bbCanvas.width = 590;
      bbCanvas.height = 495;
      const bbCtx = bbCanvas.getContext('2d');
      if (bbCtx) {
        bbCtx.drawImage(baseboardImg, 0, 0, 590, 495);
        bbCtx.globalCompositeOperation = 'source-in';
        bbCtx.fillStyle = baseColor;
        bbCtx.fillRect(0, 0, 590, 495);
        ctx.drawImage(bbCanvas, 0, 685, 590, 495);
      }
    }
  }

  // 4. Faction Icon Watermark (中间 / 阵营图标: aligned with exact PSD layer bounds for each faction)
  // ONLY rendered in E1 mode (E2 hides faction icon)
  if (!isE2 && info.show_icon !== false && layers?.factionWatermark !== false) {
    const factionIconUrl = getFactionIconUrl(info.faction);
    const factionImg = customIconImg || (factionIconUrl ? (imageCache.get(factionIconUrl) || await loadImage(factionIconUrl)) : null);

    if (isImageValid(factionImg)) {
      ctx.save();
      ctx.globalAlpha = 0.32;
      const defaultPos = getFactionIconPos(info.faction);
      let fx = defaultPos.x;
      let fy = defaultPos.y;
      let drawW = customIconImg ? (factionImg.width || defaultPos.w) : defaultPos.w;
      let drawH = customIconImg ? (factionImg.height || defaultPos.h) : defaultPos.h;

      if (e1Opts) {
        fx += e1Opts.iconX;
        fy += e1Opts.iconY;
        drawW *= e1Opts.iconScale;
        drawH *= e1Opts.iconScale;
      }

      ctx.drawImage(factionImg, fx, fy, drawW, drawH);
      ctx.restore();
    }
  }

  // 5. Decorative Overlays & Border Overlay
  if (variant === 'front' && layers?.borderOverlay !== false) {


    const arknightsLogoImg = imageCache.get('./psd_assets/正面__装饰图案__明日方舟.png') || await loadImage('./psd_assets/正面__装饰图案__明日方舟.png');
    if (isImageValid(arknightsLogoImg)) {
      ctx.drawImage(arknightsLogoImg, 452, 1102, 123, 58);
    }

    // Border Overlay (正面 / 装饰图案 / 饰边: pos x: 0, y: 0, w: 590, h: 1180)
    // Drawn BELOW barcode & text layers so barcode is on top!
    const borderImg = imageCache.get('./psd_assets/正面__装饰图案__饰边.png') || await loadImage('./psd_assets/正面__装饰图案__饰边.png');
    if (isImageValid(borderImg)) {
      ctx.drawImage(borderImg, 0, 0, 590, 1180);
    }
  }

  // 6. Barcode & Vertical Text Layer (正面 / generated_barcode: pos x: 0, y: 850, w: 55, h: 310)
  // Rendered ON TOP of border overlay
  if (layers?.barcode !== false) {
    const barcodeStr = info.barcode_text || info.english_name || info.id || 'ARKNIGHTS - R001';
    // In E1 mode, barcode line color uses baseColor (or white for maximum contrast if baseColor is dark)
    // In E2 mode, barcode line color should be black
    const barcodeColor = !isE2 ? (baseColor || '#ffffff') : '#000000';
    drawVerticalBarcode(ctx, barcodeStr, 0, 850, 55, 310, barcodeColor);

    ctx.save();
    ctx.translate(83, 1013);
    ctx.rotate(Math.PI / 2);
    ctx.font = 'bold 17px "NotoSansHans-Bold", sans-serif';
    ctx.fillStyle = barcodeColor;
    ctx.textBaseline = 'top';
    ctx.fillText(`ARKNIGHTS - ${info.id || 'R001'}`, 0, 0);
    ctx.restore();
  }

  // 7. ID & Name Text Layer (Rendered ON TOP of border overlay)
  if (layers?.idAndNameText !== false) {
    // Main Character Name (正面 / 文字 / AMIYA: pos x: 115, y: 693)
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = '84.58px "BebasNeue", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const mainName = (info.english_name || 'AMIYA').toUpperCase();
    ctx.fillText(mainName, 115, 693);

    // Secondary Name / Alias (正面 / 文字 / the omertosa: pos x: 282, y: 723)
    if (info.english_name2) {
      ctx.font = '41.67px "BebasNeue", sans-serif';
      ctx.fillText(info.english_name2.toLowerCase(), 282, 723);
    }
    ctx.restore();

    // Subtext Code (正面 / 文字 / ARKNIGHTS - R001: pos x: 115, y: 767)
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16.67px "NotoSansHans-Bold", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`ARKNIGHTS - ${info.id || 'R001'}`, 115, 767);
    ctx.restore();
  }

  // 8. Profession & Faction Line (正面 / 文字 / GUARD / RHODES ISLAND: pos x: 117, y: 1131)
  if (layers?.professionFactionText !== false) {
    const profIconUrl = getProfessionIconUrl(info.profession);
    const profIconImg = imageCache.get(profIconUrl) || await loadImage(profIconUrl);
    if (isImageValid(profIconImg)) {
      ctx.drawImage(profIconImg, 117, 993, 83, 83);
    }

    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = '16.125px "NotoSansHans-Medium", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const profEnText = getProfessionEnText(info.profession, info.profession_en);
    const factionEnText = getFactionEnText(info.faction, info.faction_en);
    ctx.fillText(`${profEnText} / ${factionEnText}`, 117, 1131);
    ctx.restore();
  }

  if (variant === 'front') {
    await drawGradientStripe(ctx, false, layers);
  }
  if (applyDiecut) {
    await applyDiecutMask(ctx, false);
  }
}

/**
 * 2. Back Card Renderer (背面) strictly based on 通行证模板傻瓜版含正反面.psd
 */
export async function renderBackCard(
  ctx: CanvasRenderingContext2D,
  info: PassCardInfo,
  cutoutObj?: HTMLImageElement | null,
  e1Opts?: E1Options | null,
  frontImgObj?: HTMLImageElement | null,
  layers?: LayerVisibilityConfig,
  applyDiecut: boolean = true
) {
  ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const baseColor = info.base_color || info.back_color || '#003466';

  // 1. Dark Slate Canvas Background for Back Card
  if (layers?.background !== false) {
    ctx.fillStyle = '#0a0e17';
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  }

  // 2. Character Cutout Silhouette (背面人物剪影: 水平镜像 + 纯卡面基础颜色蒙版)
  if (layers?.characterPhoto !== false) {
    const characterImg = cutoutObj || frontImgObj;
    if (isImageValid(characterImg)) {
      ctx.save();
      const targetW = CARD_WIDTH;
      const targetH = CARD_HEIGHT;
      const imgRatio = characterImg.width / characterImg.height;
      const targetRatio = targetW / targetH;

      let drawW = targetW;
      let drawH = targetH;
      let drawX = 0;
      let drawY = 0;

      if (imgRatio > targetRatio) {
        drawW = targetH * imgRatio;
        drawX = (targetW - drawW) / 2;
      } else {
        drawH = targetW / imgRatio;
        drawY = (targetH - drawH) / 2;
      }

      // Offscreen canvas for horizontal mirroring and solid color stencil masking
      const offCanvas = document.createElement('canvas');
      offCanvas.width = CARD_WIDTH;
      offCanvas.height = CARD_HEIGHT;
      const offCtx = offCanvas.getContext('2d');

      if (offCtx) {
        offCtx.save();
        // Translate to right edge & mirror horizontally
        offCtx.translate(CARD_WIDTH, 0);
        offCtx.scale(-1, 1);
        offCtx.drawImage(characterImg, drawX, drawY, drawW, drawH);
        offCtx.restore();

        // Mask entire shape into card base color (baseColor)
        offCtx.globalCompositeOperation = 'source-in';
        offCtx.fillStyle = baseColor;
        offCtx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

        ctx.drawImage(offCanvas, 0, 0);
      }
      ctx.restore();
    }
  }

  // 2.5. E1 Baseboard Silhouette on Back Card (精一底板背面剪影: 水平镜像 + 纯卡面基础颜色蒙版)
  const isE2ForBack = info.elite_phase === 'E2';
  if (!isE2ForBack && layers?.baseboard !== false) {
    const baseboardImg = imageCache.get('./psd_assets/中间__精一底板.png') || await loadImage('./psd_assets/中间__精一底板.png');
    if (isImageValid(baseboardImg)) {
      const offCanvas = document.createElement('canvas');
      offCanvas.width = CARD_WIDTH;
      offCanvas.height = CARD_HEIGHT;
      const offCtx = offCanvas.getContext('2d');
      if (offCtx) {
        offCtx.save();
        offCtx.translate(CARD_WIDTH, 0);
        offCtx.scale(-1, 1);
        offCtx.drawImage(baseboardImg, 0, 685, 590, 495);
        offCtx.restore();

        offCtx.globalCompositeOperation = 'source-in';
        offCtx.fillStyle = baseColor;
        offCtx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

        ctx.drawImage(offCanvas, 0, 0);
      }
    }
  }

  // 3. Back Decorative Overlays & Back Border Overlay
  if (layers?.borderOverlay !== false) {


    const trademarkImg = imageCache.get('./psd_assets/背面__文字__商标.png') || await loadImage('./psd_assets/背面__文字__商标.png');
    if (isImageValid(trademarkImg)) {
      ctx.drawImage(trademarkImg, 121, 669, 317, 54);
    }

    // Back Border Overlay (背面 / 装饰 / 饰边: pos x: 0, y: 0, w: 590, h: 1180)
    // Drawn BEFORE barcode so barcode sits ON TOP of border!
    const backBorderImg = imageCache.get('./psd_assets/背面__装饰__饰边.png') || await loadImage('./psd_assets/背面__装饰__饰边.png');
    if (isImageValid(backBorderImg)) {
      ctx.drawImage(backBorderImg, 0, 0, 590, 1180);
    }
  }

  // 4. Profession / Faction Text (背面 / 文字 / GUARD / RHODES ISLAND)
  if (layers?.professionFactionText !== false) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px "NotoSansHans-Medium", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const profEnText = getProfessionEnText(info.profession, info.profession_en);
    const factionEnText = getFactionEnText(info.faction, info.faction_en);
    ctx.fillText(`${profEnText} / ${factionEnText}`, 122, 691);
    ctx.restore();
  }

  // 5. Vertical Barcode on Right Edge (背面 / generated_barcode: pos x: 535, y: 849, w: 55, h: 310)
  // Rendered ON TOP of border overlay
  if (layers?.barcode !== false) {
    const isE2 = info.elite_phase === 'E2';
    const barcodeColor = !isE2 ? (info.base_color || '#ffffff') : '#000000';
    const barcodeStr = info.barcode_text || info.english_name || info.id || 'ARKNIGHTS - R001';
    drawVerticalBarcode(ctx, barcodeStr, 535, 849, 55, 310, barcodeColor);

    ctx.save();
    ctx.translate(521, 1013);
    ctx.rotate(Math.PI / 2);
    ctx.font = 'bold 17px "NotoSansHans-Bold", sans-serif';
    ctx.fillStyle = barcodeColor;
    ctx.textBaseline = 'top';
    ctx.fillText(`ARKNIGHTS - ${info.id || 'MN04'}`, 0, 0);
    ctx.restore();
  }

  await drawGradientStripe(ctx, true, layers);
  if (applyDiecut) {
    await applyDiecutMask(ctx, true);
  }
}

/**
 * 3. White Pass Card Renderer (白墨图/白墨层)
 * Standard Acrylic Print White Ink Stencil Mask:
 * - Graphics areas (边框, 精一底板(若有), 职业图标/文字, 名字, 干员抠图): Solid BLACK (#000000, Alpha = 255)
 * - Background / non-graphics areas: Fully TRANSPARENT (Alpha = 0)
 */
export async function renderWhiteCard(
  ctx: CanvasRenderingContext2D,
  info: PassCardInfo,
  cutoutObj?: HTMLImageElement | null,
  e1Opts?: E1Options | null,
  frontImgObj?: HTMLImageElement | null,
  customIconObj?: HTMLImageElement | null,
  layers?: LayerVisibilityConfig,
  applyDiecut: boolean = true
) {
  ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // 1. Offscreen Canvas for generating white ink stencil elements
  const offCanvas = document.createElement('canvas');
  offCanvas.width = CARD_WIDTH;
  offCanvas.height = CARD_HEIGHT;
  const offCtx = offCanvas.getContext('2d');
  if (!offCtx) return;

  offCtx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const isE2 = info.elite_phase === 'E2';

  // 边框位于中层最底部，不能覆盖精一底板和人物抠图。
  if (layers?.borderOverlay !== false) {
    const borderImg = imageCache.get('./psd_assets/正面__装饰图案__饰边.png') || await loadImage('./psd_assets/正面__装饰图案__饰边.png');
    if (isImageValid(borderImg)) {
      offCtx.drawImage(borderImg, 0, 0, 590, 1180);
    }
  }

  // A. Cutout photo part (干员的抠图部分)
  if (layers?.characterPhoto !== false) {
    const activeCutout = isImageValid(cutoutObj) ? cutoutObj : (isImageValid(frontImgObj) ? frontImgObj : null);
    if (activeCutout) {
      offCtx.save();
      const targetW = CARD_WIDTH;
      const targetH = CARD_HEIGHT;
      const imgRatio = activeCutout.width / activeCutout.height;
      const targetRatio = targetW / targetH;

      let drawW = targetW;
      let drawH = targetH;
      let drawX = 0;
      let drawY = 0;

      if (imgRatio > targetRatio) {
        drawH = targetH;
        drawW = targetH * imgRatio;
        drawX = (targetW - drawW) / 2;
        drawY = 0;
      } else {
        drawW = targetW;
        drawH = targetW / imgRatio;
        drawX = 0;
        drawY = (targetH - drawH) / 2;
      }

      offCtx.drawImage(activeCutout, drawX, drawY, drawW, drawH);
      offCtx.restore();
    }
  }

  // B. E1 Baseboard Overlay (精一底板 - 若有)
  if (!isE2 && layers?.baseboard !== false) {
    const baseboardImg = imageCache.get('./psd_assets/中间__精一底板.png') || await loadImage('./psd_assets/中间__精一底板.png');
    if (isImageValid(baseboardImg)) {
      offCtx.drawImage(baseboardImg, 0, 685, 590, 495);
    }
  }

  // C. Border Overlay 已在中层绘制开始时放置于最底部。

  // D. Operator Name (名字: Chinese & English Name)
  if (layers?.idAndNameText !== false) {
    offCtx.save();
    offCtx.fillStyle = '#000000';
    offCtx.font = '84.58px "BebasNeue", sans-serif';
    offCtx.textAlign = 'left';
    offCtx.textBaseline = 'top';
    const mainName = (info.english_name || 'AMIYA').toUpperCase();
    offCtx.fillText(mainName, 115, 693);

    if (info.english_name2) {
      offCtx.font = '41.67px "BebasNeue", sans-serif';
      offCtx.fillText(info.english_name2.toLowerCase(), 282, 723);
    }

    offCtx.font = 'bold 16.67px "NotoSansHans-Bold", sans-serif';
    offCtx.fillText(`ARKNIGHTS - ${info.id || 'R001'}`, 115, 767);
    offCtx.restore();
  }

  // E. Profession (职业图标与职业/势力英文)
  if (layers?.professionFactionText !== false) {
    const profIconUrl = getProfessionIconUrl(info.profession);
    const profIconImg = imageCache.get(profIconUrl) || await loadImage(profIconUrl);
    if (isImageValid(profIconImg)) {
      offCtx.drawImage(profIconImg, 117, 993, 83, 83);
    }

    offCtx.save();
    offCtx.fillStyle = '#000000';
    offCtx.font = '16.125px "NotoSansHans-Medium", sans-serif';
    offCtx.textAlign = 'left';
    offCtx.textBaseline = 'top';
    const profEnText = getProfessionEnText(info.profession);
    const factionEnText = info.faction_en !== undefined ? info.faction_en : getFactionEnText(info.faction);
    offCtx.fillText(`${profEnText} / ${factionEnText}`, 117, 1086);
    offCtx.restore();
  }

    await drawGradientStripe(offCtx, false, layers);

  // 2. Convert all non-transparent graphic pixels (alpha > 10) into solid BLACK (#000000, Alpha = 255)
  // All other pixels remain fully TRANSPARENT (Alpha = 0)
  const imgData = offCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 10) {
      data[i] = 0;       // Red = 0
      data[i + 1] = 0;   // Green = 0
      data[i + 2] = 0;   // Blue = 0
      data[i + 3] = 255; // Alpha = 255 (Opaque Black)
    } else {
      data[i + 3] = 0;   // Transparent
    }
  }
  offCtx.putImageData(imgData, 0, 0);

  // 3. Draw black stencil on transparent canvas
  ctx.drawImage(offCanvas, 0, 0);
  if (applyDiecut) {
    await applyDiecutMask(ctx, true);
  }
}

/**
 * 4. Diecut Line Card Renderer (刀模版)
 */
export async function renderDiecutCard(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const diecutImg = imageCache.get('./psd_assets/刀线.png') || await loadImage('./psd_assets/刀线.png');
  if (isImageValid(diecutImg)) {
    ctx.drawImage(diecutImg, 0, 0, 590, 1180);
  }
}

async function drawGradientStripe(ctx: CanvasRenderingContext2D, isBack: boolean, layers?: LayerVisibilityConfig) {
  if (layers?.borderOverlay === false) return;
  const assetName = isBack ? './psd_assets/背面__装饰__渐变条纹.png' : './psd_assets/正面__装饰图案__渐变条纹.png';
  const img = imageCache.get(assetName) || await loadImage(assetName);
  if (isImageValid(img)) {
    ctx.drawImage(img, isBack ? 483 : 95, 684, 13, 496);
  }
}

// --- BFS Flood Fill Masking for Diecut Precision ---
let cachedMaskCanvas: HTMLCanvasElement | null = null;
let maskPromise: Promise<HTMLCanvasElement | null> | null = null;

export function getDiecutMask(): Promise<HTMLCanvasElement | null> {
  if (cachedMaskCanvas) return Promise.resolve(cachedMaskCanvas);
  if (maskPromise) return maskPromise;

  maskPromise = (async () => {
    try {
      const diecutImg = imageCache.get('./psd_assets/刀线.png') || await loadImage('./psd_assets/刀线.png');
      if (!isImageValid(diecutImg)) {
        return null;
      }

      const w = CARD_WIDTH;
      const h = CARD_HEIGHT;

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = w;
      tempCanvas.height = h;
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) return null;

      // Draw diecut line image
      tempCtx.drawImage(diecutImg, 0, 0, w, h);
      const imgData = tempCtx.getImageData(0, 0, w, h);
      const data = imgData.data;

      const visited = new Uint8Array(w * h);
      const queue = new Int32Array(w * h);
      let head = 0;
      let tail = 0;

      // Enqueue all transparent border pixels (alpha < 50)
      // Top and bottom rows
      for (let x = 0; x < w; x++) {
        // Top row
        const idxTop = x;
        if (data[idxTop * 4 + 3] < 50) {
          visited[idxTop] = 1;
          queue[tail++] = idxTop;
        }
        // Bottom row
        const idxBot = (h - 1) * w + x;
        if (data[idxBot * 4 + 3] < 50) {
          visited[idxBot] = 1;
          queue[tail++] = idxBot;
        }
      }

      // Left and right columns (excluding corners already handled)
      for (let y = 1; y < h - 1; y++) {
        // Left column
        const idxLeft = y * w;
        if (data[idxLeft * 4 + 3] < 50) {
          visited[idxLeft] = 1;
          queue[tail++] = idxLeft;
        }
        // Right column
        const idxRight = y * w + (w - 1);
        if (data[idxRight * 4 + 3] < 50) {
          visited[idxRight] = 1;
          queue[tail++] = idxRight;
        }
      }

      // Start from the geometric center of the canvas. In this diecut style, the center is guaranteed
      // to fall inside the important transparent interior region (region 2). From there, BFS finds the
      // whole transparent region 2 and its boundary. That boundary includes the white curves 1 and 2.
      // The final mask keeps exactly this region 2 + boundary, while the enclosed area inside white curve 2
      // is treated as the real hole to be excavated.
      const cx = Math.floor(w / 2);
      const cy = Math.floor(h / 2);
      const centerIdx = cy * w + cx;

      if (data[centerIdx * 4 + 3] < 50) {
        const keepSet = new Uint8Array(w * h);
        const regionQueue = new Int32Array(w * h);
        let regionHead = 0;
        let regionTail = 0;

        regionQueue[regionTail++] = centerIdx;
        keepSet[centerIdx] = 1;

        while (regionHead < regionTail) {
          const curr = regionQueue[regionHead++];
          const x = curr % w;
          const y = Math.floor(curr / w);

          const nxs = [x - 1, x + 1, x, x];
          const nys = [y, y, y - 1, y + 1];
          for (let i = 0; i < 4; i++) {
            const nx = nxs[i];
            const ny = nys[i];
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const nidx = ny * w + nx;
              if (!keepSet[nidx]) {
                const nAlpha = data[nidx * 4 + 3];
                if (nAlpha < 50) {
                  keepSet[nidx] = 1;
                  regionQueue[regionTail++] = nidx;
                }
              }
            }
          }
        }

        // Add the boundary pixels around the found transparent region. This boundary contains both white
        // curve 1 and white curve 2, which are the parts we want to keep.
        for (let i = 0; i < w * h; i++) {
          if (!keepSet[i]) continue;

          const x = i % w;
          const y = Math.floor(i / w);
          const nxs = [x - 1, x + 1, x, x];
          const nys = [y, y, y - 1, y + 1];

          for (let j = 0; j < 4; j++) {
            const nx = nxs[j];
            const ny = nys[j];
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const nidx = ny * w + nx;
              if (data[nidx * 4 + 3] >= 50) {
                keepSet[nidx] = 1;
              }
            }
          }
        }

        const maskImgData = tempCtx.createImageData(w, h);
        const mData = maskImgData.data;
        for (let i = 0; i < w * h; i++) {
          const shouldKeep = keepSet[i] === 1;
          if (shouldKeep) {
            mData[i * 4] = 255;
            mData[i * 4 + 1] = 255;
            mData[i * 4 + 2] = 255;
            mData[i * 4 + 3] = 255;
          } else {
            mData[i * 4] = 0;
            mData[i * 4 + 1] = 0;
            mData[i * 4 + 2] = 0;
            mData[i * 4 + 3] = 0;
          }
        }

        tempCtx.putImageData(maskImgData, 0, 0);
        cachedMaskCanvas = tempCanvas;
        return cachedMaskCanvas;
      }

      // Fallback: if the center is not inside a transparent hole, preserve the original large-body logic.
      while (head < tail) {
        const curr = queue[head++];
        const cx = curr % w;
        const cy = Math.floor(curr / w);

        const nxs = [cx - 1, cx + 1, cx, cx];
        const nys = [cy, cy, cy - 1, cy + 1];

        for (let i = 0; i < 4; i++) {
          const nx = nxs[i];
          const ny = nys[i];

          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const nidx = ny * w + nx;
            if (!visited[nidx]) {
              const alpha = data[nidx * 4 + 3];
              if (alpha < 50) {
                visited[nidx] = 1;
                queue[tail++] = nidx;
              }
            }
          }
        }
      }

      const maskImgData = tempCtx.createImageData(w, h);
      const mData = maskImgData.data;
      for (let i = 0; i < w * h; i++) {
        if (visited[i] === 1) {
          mData[i * 4] = 0;
          mData[i * 4 + 1] = 0;
          mData[i * 4 + 2] = 0;
          mData[i * 4 + 3] = 0;
        } else {
          mData[i * 4] = 255;
          mData[i * 4 + 1] = 255;
          mData[i * 4 + 2] = 255;
          mData[i * 4 + 3] = 255;
        }
      }

      tempCtx.putImageData(maskImgData, 0, 0);
      cachedMaskCanvas = tempCanvas;
      return cachedMaskCanvas;
    } catch (e) {
      console.error('Failed to create diecut mask:', e);
      return null;
    }
  })();

  return maskPromise;
}

export async function applyDiecutMask(ctx: CanvasRenderingContext2D, mirror: boolean = false) {
  const mask = await getDiecutMask();
  if (mask) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    if (mirror) {
      ctx.translate(CARD_WIDTH, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(mask, 0, 0);
    ctx.restore();
  }
}
