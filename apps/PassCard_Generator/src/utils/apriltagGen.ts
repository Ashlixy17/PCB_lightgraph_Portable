/**
 * AprilTag 生成工具：用固定的 tag36h11 家族渲染 AR 锚点图（供打印/展示后摄像头识别）。
 * 通行证本身的内容（条形码/二维码）不受影响。
 */
import { AprilTagFamily, Pixel } from 'apriltag';
import tagConfig36h11 from 'apriltag/families/36h11.json';

const family = new AprilTagFamily(tagConfig36h11 as { size: number; layout: string; codes: number[] });

/** AR 锚点使用的固定 tag id */
export const AR_APRILTAG_ID = 0;

/**
 * 渲染 AprilTag 为 PNG dataURL。
 * @param tagId tag id（默认 0）
 * @param pixelSize 每个模块的像素数
 * @param marginModules 四周白色 quiet zone 的模块数
 */
export function renderAprilTagDataUrl(
  tagId: number = AR_APRILTAG_ID,
  pixelSize = 10,
  marginModules = 2
): string {
  const grid: Pixel[][] = family.render(tagId);
  const n = grid.length;
  const size = (n + marginModules * 2) * pixelSize;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (grid[y][x] === 'b') {
        ctx.fillRect((x + marginModules) * pixelSize, (y + marginModules) * pixelSize, pixelSize, pixelSize);
      }
    }
  }
  return canvas.toDataURL('image/png');
}
