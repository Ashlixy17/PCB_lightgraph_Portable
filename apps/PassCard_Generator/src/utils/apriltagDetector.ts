import {generatorAssetUrl} from './assetUrl';

/**
 * AprilTag WASM 检测器封装（基于 arenaxr/apriltag-js-standalone 预编译的 wasm，tag36h11 家族）。
 *
 * - wasm 文件位于 public/wasm/，通过动态 <script> 加载（Emscripten MODULARIZE 全局 AprilTagWasm）
 * - 检测灰度图，返回 4 角点（AprilTag 标准顺序 [BL, BR, TR, TL]）
 * - 位姿仍复用 qrPose.ts（estimateQRPose），不依赖 wasm 内置的 pose
 */

let modulePromise: Promise<any> | null = null;
// cwrap 包装后的 C API（该 wasm 构建只有 cwrap，没有 ccall）
let api: {
  init: () => number;
  setOptions: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
  setImgBuffer: (w: number, h: number, stride: number) => number;
  detect: () => number;
} | null = null;

function ensureScriptLoaded(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof (window as any).AprilTagWasm !== 'undefined') {
      resolve();
      return;
    }
    const s = document.createElement('script');
    // 与字体共用生成器资源目录，避免访问 PCB 站点根目录。
    s.src = generatorAssetUrl('wasm/apriltag_wasm.js');
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('AprilTag WASM 脚本加载失败'));
    document.head.appendChild(s);
  });
}

async function getModule(): Promise<any> {
  if (!modulePromise) {
    modulePromise = (async () => {
      await ensureScriptLoaded();
      const factory = (window as any).AprilTagWasm;
      if (!factory) throw new Error('AprilTagWasm 工厂不可用');
      const mod = await factory({
        wasmBinaryFile: generatorAssetUrl('wasm/apriltag_wasm.wasm'),
      });
      // 用 cwrap 包装（该构建无 ccall）。tag36h11 固定家族；return_pose=0（位姿用我们自己的 estimateQRPose）
      const cwrap = mod.cwrap;
      api = {
        init: cwrap('atagjs_init', 'number', []),
        setOptions: cwrap('atagjs_set_detector_options', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number']),
        setImgBuffer: cwrap('atagjs_set_img_buffer', 'number', ['number', 'number', 'number']),
        detect: cwrap('atagjs_detect', 'number', []),
      };
      api.init();
      // decimate=1.0：不做降采样。手机摄像头场景 tag 通常较小，
      // 1.5 倍降采样会进一步缩小导致漏检；1.0 保留原始像素以提升小 tag 检测率。
      // refine_edges=1 精化边缘。
      api.setOptions(1.0, 0.0, 1, 1, 0, 0, 0);
      mod._imgPtr = 0;
      mod._imgW = 0;
      mod._imgH = 0;
      return mod;
    })();
    modulePromise.catch(() => {
      modulePromise = null; // 失败后允许重试
    });
  }
  return modulePromise;
}

export interface AprilTagPoint {
  x: number;
  y: number;
}

export interface AprilTagDetection {
  id: number;
  /** 4 角点，顺序 [BL, BR, TR, TL]（AprilTag 标准） */
  corners: AprilTagPoint[];
  center: AprilTagPoint;
}

/**
 * 预加载并初始化 AprilTag wasm 检测器（幂等，可多次调用）。
 * 在打开 AR 时提前调用，避免首帧检测等待 wasm 加载。
 */
export async function initAprilTag(): Promise<void> {
  await getModule();
}

/**
 * 检测灰度图中的 AprilTag。失败或未初始化返回 null，无检测返回 []。
 * @param grayscale 灰度像素（0-255，长度 w*h）
 */
export async function detectAprilTags(
  grayscale: Uint8Array,
  w: number,
  h: number
): Promise<AprilTagDetection[] | null> {
  try {
    const mod = await getModule();
    if (!api) return null;
    if (mod._imgW !== w || mod._imgH !== h) {
      mod._imgPtr = api.setImgBuffer(w, h, w);
      mod._imgW = w;
      mod._imgH = h;
    }
    mod.HEAPU8.set(grayscale, mod._imgPtr);
    const strJsonPtr = api.detect();
    const len = mod.getValue(strJsonPtr, 'i32');
    if (!len) return [];
    const strPtr = mod.getValue(strJsonPtr + 4, 'i32');
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(mod.HEAP8[strPtr + i]);
    const dets = JSON.parse(s);
    return dets.map((d: any) => ({
      id: d.id,
      corners: d.corners.map((p: any) => ({ x: p.x, y: p.y })),
      center: d.center,
    }));
  } catch (err) {
    console.warn('AprilTag 检测失败:', err);
    return null;
  }
}
