import * as THREE from 'three';
import { CARD_WIDTH, CARD_HEIGHT } from './passRenderer';

// 3D 空间中的卡牌尺寸（1 单位 = 1cm）
export const CARD_W3D = 5.0;
export const CARD_H3D = 10.0;

interface Pt {
  x: number;
  y: number;
}

/**
 * 点到线段的最短距离（用于 RDP 轮廓简化）
 */
function pointSegDist(p: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  return Math.hypot(p.x - cx, p.y - cy);
}

/**
 * Ramer–Douglas–Peucker 轮廓简化
 */
function rdpSimplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length <= 3) return pts.slice();
  const n = pts.length;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    if (e - s <= 1) continue;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = pointSegDist(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > eps) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

/**
 * 多边形有向面积（Shoelace，y 向上坐标系，逆时针为正）
 */
function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/**
 * 从刀线 mask（白 = 保留区域，透明 = 挖空区域）提取轮廓，
 * 构建一个带孔洞的 THREE.Shape（3D 坐标：宽 5.0、高 10.0、中心在原点、y 向上）。
 * 该 Shape 沿垂直方向扫出的体积即与刀线保留区域一致（含内部孔洞）。
 */
export function buildDiecutShape(maskCanvas: HTMLCanvasElement | null): THREE.Shape | null {
  if (!maskCanvas) return null;
  const w = maskCanvas.width || CARD_WIDTH;
  const h = maskCanvas.height || CARD_HEIGHT;
  const ctx = maskCanvas.getContext('2d');
  if (!ctx) return null;

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // 1. 二值化：alpha > 127 视为保留区域
  const grid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    grid[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  }

  // 2. 提取轮廓边（格点坐标）：保留像素与挖空像素/画布边界之间的分隔边
  const edges: Array<[number, number, number, number]> = [];
  const edgeSet = new Set<string>();
  const addEdge = (x1: number, y1: number, x2: number, y2: number) => {
    const minx = Math.min(x1, x2);
    const maxx = Math.max(x1, x2);
    const miny = Math.min(y1, y2);
    const maxy = Math.max(y1, y2);
    const key = `${minx},${miny},${maxx},${maxy}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push([x1, y1, x2, y2]);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y * w + x] !== 1) continue;
      // 上边
      if (y === 0 || grid[(y - 1) * w + x] !== 1) addEdge(x, y, x + 1, y);
      // 下边
      if (y === h - 1 || grid[(y + 1) * w + x] !== 1) addEdge(x, y + 1, x + 1, y + 1);
      // 左边
      if (x === 0 || grid[y * w + (x - 1)] !== 1) addEdge(x, y, x, y + 1);
      // 右边
      if (x === w - 1 || grid[y * w + (x + 1)] !== 1) addEdge(x + 1, y, x + 1, y + 1);
    }
  }

  if (edges.length === 0) return null;

  // 3. 格点邻接表
  const keyOf = (x: number, y: number) => `${x},${y}`;
  const adj = new Map<string, Array<[number, number]>>();
  for (const [x1, y1, x2, y2] of edges) {
    const k1 = keyOf(x1, y1);
    const k2 = keyOf(x2, y2);
    if (!adj.has(k1)) adj.set(k1, []);
    if (!adj.has(k2)) adj.set(k2, []);
    adj.get(k1)!.push([x2, y2]);
    adj.get(k2)!.push([x1, y1]);
  }

  // 4. 沿轮廓边追踪封闭环
  const usedEdges = new Set<string>();
  const rings: Pt[][] = [];
  const usedEdgeKey = (a: [number, number], b: [number, number]) => {
    const minx = Math.min(a[0], b[0]);
    const maxx = Math.max(a[0], b[0]);
    const miny = Math.min(a[1], b[1]);
    const maxy = Math.max(a[1], b[1]);
    return `${minx},${miny},${maxx},${maxy}`;
  };

  for (const [x1, y1, x2, y2] of edges) {
    if (usedEdges.has(usedEdgeKey([x1, y1], [x2, y2]))) continue;

    const start: [number, number] = [x1, y1];
    let cur: [number, number] = [x1, y1];
    let nxt: [number, number] = [x2, y2];
    usedEdges.add(usedEdgeKey(cur, nxt));

    const ring: Pt[] = [{ x: cur[0], y: cur[1] }];
    let guard = 0;
    let closed = false;
    while (guard++ < w * h * 4) {
      ring.push({ x: nxt[0], y: nxt[1] });
      if (nxt[0] === start[0] && nxt[1] === start[1]) {
        closed = true;
        break;
      }

      const candidates = adj.get(keyOf(nxt[0], nxt[1])) || [];
      const curDir: [number, number] = [nxt[0] - cur[0], nxt[1] - cur[1]];
      let nextPt: [number, number] | null = null;
      let bestScore = Infinity;
      for (const cand of candidates) {
        if (cand[0] === cur[0] && cand[1] === cur[1]) continue; // 不走回头路
        const ek = usedEdgeKey(nxt, cand);
        if (usedEdges.has(ek)) continue;
        // 在交叉点处优先“直行”，保持轮廓连续
        const ddx = cand[0] - nxt[0];
        const ddy = cand[1] - nxt[1];
        const dot = curDir[0] * ddx + curDir[1] * ddy;
        const score = -dot;
        if (score < bestScore) {
          bestScore = score;
          nextPt = cand;
        }
      }

      if (!nextPt) break; // 死路：无法闭合
      usedEdges.add(usedEdgeKey(nxt, nextPt));
      cur = nxt;
      nxt = nextPt;
    }

    if (closed && ring.length >= 4) rings.push(ring);
  }

  if (rings.length === 0) return null;

  // 5. 像素坐标 -> 3D 坐标（y 向上、中心在原点）
  const to3D = (p: Pt): Pt => ({
    x: ((p.x - w / 2) / w) * CARD_W3D,
    y: ((h / 2 - p.y) / h) * CARD_H3D,
  });
  const rings3D: Pt[][] = rings.map((r) => r.map(to3D));

  // 6. 面积最大的环为外轮廓，其余为孔洞
  let outerIdx = 0;
  let maxAbs = 0;
  rings3D.forEach((r, i) => {
    const a = Math.abs(signedArea(r));
    if (a > maxAbs) {
      maxAbs = a;
      outerIdx = i;
    }
  });
  const outer = rings3D[outerIdx];
  const holes = rings3D.filter((_, i) => i !== outerIdx);

  // 7. RDP 简化（epsilon 对应约 2.4 像素）
  const EPS = 0.02;
  const outerSimplified = rdpSimplify(outer, EPS);
  if (outerSimplified.length < 4) return null;

  // 8. 统一方向：外轮廓逆时针（CCW），孔洞顺时针（CW），满足 Three.js 三角化约定
  const toCCW = (pts: Pt[]) => {
    if (signedArea(pts) < 0) pts.reverse();
  };
  const toCW = (pts: Pt[]) => {
    if (signedArea(pts) > 0) pts.reverse();
  };
  toCCW(outerSimplified);

  const shape = new THREE.Shape();
  shape.moveTo(outerSimplified[0].x, outerSimplified[0].y);
  for (let i = 1; i < outerSimplified.length; i++) {
    shape.lineTo(outerSimplified[i].x, outerSimplified[i].y);
  }
  shape.closePath();

  for (const hole of holes) {
    const simplified = rdpSimplify(hole, EPS);
    if (simplified.length < 4) continue; // 过滤过小噪点孔洞
    toCW(simplified);
    const path = new THREE.Path();
    path.moveTo(simplified[0].x, simplified[0].y);
    for (let i = 1; i < simplified.length; i++) {
      path.lineTo(simplified[i].x, simplified[i].y);
    }
    path.closePath();
    shape.holes.push(path);
  }

  return shape;
}

/**
 * 兜底：当刀线 mask 无法获取时，退化为完整矩形卡面形状
 */
export function createFallbackShape(): THREE.Shape {
  const shape = new THREE.Shape();
  const x = -CARD_W3D / 2;
  const y = -CARD_H3D / 2;
  shape.moveTo(x, y);
  shape.lineTo(x + CARD_W3D, y);
  shape.lineTo(x + CARD_W3D, y + CARD_H3D);
  shape.lineTo(x, y + CARD_H3D);
  shape.closePath();
  return shape;
}
