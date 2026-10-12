import * as THREE from 'three';

export interface QRPose {
  valid: boolean;
  /**
   * 二维码中心在 Three.js 场景/相机坐标系中的位置（相机位于原点、朝向 -Z、
   * +Y 向上，单位与 qrSizeCm 一致，cm）。即与渲染相机的坐标系完全一致。
   */
  position: THREE.Vector3;
  /** 二维码平面的旋转（场景坐标系），平面局部 +Z = 平面法线（朝向相机） */
  quaternion: THREE.Quaternion;
  /** 二维码平面法线（指向相机，即远离桌面的方向） */
  normal: THREE.Vector3;
}

/**
 * 通过 4 组对应点求解单应矩阵 H（映射世界平面点 (X,Y,1) -> 图像点 (u,v,1)）。
 * 使用 DLT + 固定 h33=1 的最小二乘（法方程 + 高斯消元），避免完整 SVD。
 */
export function solveHomographyDLT(
  src: number[][],
  dst: number[][]
): number[] | null {
  const rows: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const [X, Y] = src[i];
    const [u, v] = dst[i];
    // 标准 DLT 两行（h33=1 时移到右侧）
    rows.push([-X, -Y, -1, 0, 0, 0, u * X, u * Y]);
    rhs.push(-u);
    rows.push([0, 0, 0, -X, -Y, -1, v * X, v * Y]);
    rhs.push(-v);
  }

  const n = 8;
  // 法方程：N = B^T B，c = B^T rhs
  const N: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const c: number[] = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < rows.length; k++) s += rows[k][i] * rows[k][j];
      N[i][j] = s;
    }
    for (let k = 0; k < rows.length; k++) c[i] += rows[k][i] * rhs[k];
  }

  // 增广矩阵 + 高斯消元（列主元）
  const M = N.map((row, i) => [...row, c[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-10) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let c2 = col; c2 <= n; c2++) M[r][c2] -= f * M[col][c2];
    }
  }
  const h = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c2 = r + 1; c2 < n; c2++) s -= M[r][c2] * h[c2];
    h[r] = s / M[r][r];
  }
  return [...h, 1];
}

/** 轴角 -> 旋转矩阵（Rodrigues） */
function rodrigues(wx: number, wy: number, wz: number): THREE.Matrix3 {
  const th = Math.sqrt(wx * wx + wy * wy + wz * wz);
  if (th < 1e-12) return new THREE.Matrix3().identity();
  const K = new THREE.Matrix3().set(0, -wz, wy, wz, 0, -wx, -wy, wx, 0);
  const a = Math.sin(th) / th;
  const b = (1 - Math.cos(th)) / (th * th);
  const K2 = new THREE.Matrix3().multiplyMatrices(K, K);
  // R = I + a*K + b*K2（逐元素，列主序）
  const ek = K.elements;
  const ek2 = K2.elements;
  const r = new THREE.Matrix3().elements;
  const Ie = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let i = 0; i < 9; i++) r[i] = Ie[i] + a * ek[i] + b * ek2[i];
  return new THREE.Matrix3().set(
    r[0], r[3], r[6],
    r[1], r[4], r[7],
    r[2], r[5], r[8]
  );
}

/** 旋转矩阵 -> 轴角 */
function matrixToAxisAngle(R: THREE.Matrix3): { axis: THREE.Vector3; angle: number } {
  const e = R.elements; // 列主序: [R00,R10,R20, R01,R11,R21, R02,R12,R22]
  const trace = e[0] + e[4] + e[8];
  const angle = Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2)));
  if (angle < 1e-8) {
    return { axis: new THREE.Vector3(0, 1, 0), angle: 0 };
  }
  const s = 2 * Math.sin(angle);
  // w_x=(R21-R12)/s, w_y=(R02-R20)/s, w_z=(R10-R01)/s
  const axis = new THREE.Vector3(
    (e[5] - e[7]) / s,
    (e[6] - e[2]) / s,
    (e[1] - e[3]) / s
  ).normalize();
  return { axis, angle };
}

/**
 * 对称 3×3 矩阵（列主序 elements）的 Jacobi 特征分解。
 * 返回特征值（降序）与特征向量矩阵 V（列为特征向量，正交单位）。
 * 内部用行主序 number[][] 实现，避免列主序索引混淆。
 */
export function jacobiSymmetric3(A: number[]): { values: number[]; V: THREE.Matrix3 } {
  // 转行主序
  const a = [
    [A[0], A[3], A[6]],
    [A[1], A[4], A[7]],
    [A[2], A[5], A[8]],
  ];
  const V = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 60; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-14) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      const apq = a[p][q];
      if (Math.abs(apq) < 1e-14) continue;
      const app = a[p][p];
      const aqq = a[q][q];
      const theta = (aqq - app) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      const r = 3 - p - q;
      const apr = a[p][r];
      const aqr = a[q][r];
      // A ← J^T A J
      a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
      a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
      a[p][q] = 0;
      a[q][p] = 0;
      a[p][r] = c * apr - s * aqr;
      a[r][p] = a[p][r];
      a[q][r] = s * apr + c * aqr;
      a[r][q] = a[q][r];
      // V ← V J（V 的第 p、q 列线性组合）
      for (let i = 0; i < 3; i++) {
        const vip = V[i][p];
        const viq = V[i][q];
        V[i][p] = c * vip - s * viq;
        V[i][q] = s * vip + c * viq;
      }
    }
  }
  // 特征值降序排列，同时重排 V 列
  const idx = [0, 1, 2].sort((x, y) => a[y][y] - a[x][x]);
  const values = idx.map((i) => a[i][i]);
  const V2 = new THREE.Matrix3().set(
    V[0][idx[0]], V[0][idx[1]], V[0][idx[2]],
    V[1][idx[0]], V[1][idx[1]], V[1][idx[2]],
    V[2][idx[0]], V[2][idx[1]], V[2][idx[2]],
  );
  return { values, V: V2 };
}

/** 3×3 矩阵 SVD（A = U·diag(S)·V^T）。通过 A^T A 的 Jacobi 特征分解构造。 */
export function svd3(A: THREE.Matrix3): { U: THREE.Matrix3; S: number[]; V: THREE.Matrix3 } {
  const e = A.elements;
  // B = A^T A（对称半正定）
  const B = [
    e[0] * e[0] + e[1] * e[1] + e[2] * e[2],
    e[0] * e[3] + e[1] * e[4] + e[2] * e[5],
    e[0] * e[6] + e[1] * e[7] + e[2] * e[8],
    e[0] * e[3] + e[1] * e[4] + e[2] * e[5],
    e[3] * e[3] + e[4] * e[4] + e[5] * e[5],
    e[3] * e[6] + e[4] * e[7] + e[5] * e[8],
    e[0] * e[6] + e[1] * e[7] + e[2] * e[8],
    e[3] * e[6] + e[4] * e[7] + e[5] * e[8],
    e[6] * e[6] + e[7] * e[7] + e[8] * e[8],
  ];
  const { values, V } = jacobiSymmetric3(B);
  const S = values.map((v) => Math.sqrt(Math.max(0, v)));
  const U = new THREE.Matrix3();
  const Ue = U.elements;
  for (let col = 0; col < 3; col++) {
    const vc = [V.elements[col * 3], V.elements[col * 3 + 1], V.elements[col * 3 + 2]];
    const av = [
      e[0] * vc[0] + e[3] * vc[1] + e[6] * vc[2],
      e[1] * vc[0] + e[4] * vc[1] + e[7] * vc[2],
      e[2] * vc[0] + e[5] * vc[1] + e[8] * vc[2],
    ];
    if (S[col] > 1e-10) {
      Ue[col * 3] = av[0] / S[col];
      Ue[col * 3 + 1] = av[1] / S[col];
      Ue[col * 3 + 2] = av[2] / S[col];
    } else {
      // 零奇异值方向：用叉积构造正交补（顺序保证最终 det(U)=±1）
      const prev = (col + 2) % 3;
      const cur = (col + 1) % 3;
      const uPrev = [Ue[prev * 3], Ue[prev * 3 + 1], Ue[prev * 3 + 2]];
      const uCur = [Ue[cur * 3], Ue[cur * 3 + 1], Ue[cur * 3 + 2]];
      const cross = [
        uPrev[1] * uCur[2] - uPrev[2] * uCur[1],
        uPrev[2] * uCur[0] - uPrev[0] * uCur[2],
        uPrev[0] * uCur[1] - uPrev[1] * uCur[0],
      ];
      const n = Math.hypot(cross[0], cross[1], cross[2]) || 1;
      Ue[col * 3] = cross[0] / n;
      Ue[col * 3 + 1] = cross[1] / n;
      Ue[col * 3 + 2] = cross[2] / n;
    }
  }
  return { U, S, V };
}

/**
 * 3×3 极分解（Polar Decomposition）：M = R·S，R 是"最接近"M 的旋转矩阵（SO(3)）。
 * 通过 SVD：R = U·V^T。这是对整矩阵的全局最优正交化，
 * 与 Gram-Schmidt 的串行投影不同，不受向量顺序影响，大透视下更稳定（AprilTag 同款做法）。
 */
function polarDecompose(M: THREE.Matrix3): THREE.Matrix3 {
  const { U, S: _S, V } = svd3(M);
  const R = U.clone().multiply(V.clone().transpose());
  // 保证 det(R) = +1（右手系）：若 det<0，只需翻转第三列（U 第三列取反），
  // 使 R 仍是"最近的"旋转矩阵。整体乘 -1 会把 4 个方向全翻转，产生错误旋转。
  if (R.determinant() < 0) {
    const e = R.elements;
    e[6] = -e[6];
    e[7] = -e[7];
    e[8] = -e[8];
  }
  return R;
}

/**
 * 正交迭代（Orthogonal Iteration，Lu et al. 2000，AprilTag 同款）：
 * 交替固定 R 优化 t、固定 t 优化 R，最小化"物方重投影误差"（object-space error）。
 * 相比像素域的高斯-牛顿 PnP，对平面 tag 的角点噪声更鲁棒、无数值雅可比奇异问题。
 *
 * @param objectPoints 平面点 [x,y]（tag 局部坐标，z=0，单位与 qrSizeCm 一致）
 * @param imagePoints  对应图像点 [u,v]（像素）
 */
export function orthogonalIteration(
  objectPoints: number[][],
  imagePoints: number[][],
  fx: number,
  fy: number,
  cx: number,
  cy: number,
  R0: THREE.Matrix3,
  t0: THREE.Vector3,
  nSteps = 50
): { R: THREE.Matrix3; t: THREE.Vector3 } | null {
  // 内部统一使用 CV 相机坐标（+Z 向前，z>0 在相机前方），与观测方向 v=(x_n,y_n,1) 一致。
  // 传入的 R0/t0 是 Three.js 坐标（+Y 向上、-Z 向前），需转换；返回时再转回。
  const flipV = (v: THREE.Vector3) => new THREE.Vector3(v.x, -v.y, -v.z);
  const toCV = (R: THREE.Matrix3) => {
    const e = R.elements;
    return new THREE.Matrix3().set(
      e[0], e[3], e[6],
      -e[1], -e[4], -e[7],
      -e[2], -e[5], -e[8]
    );
  };
  // 归一化观测方向 v_i = ((u-cx)/fx, (v-cy)/fy, 1)
  const v: THREE.Vector3[] = [];
  for (const [u, vv] of imagePoints) {
    v.push(new THREE.Vector3((u - cx) / fx, (vv - cy) / fy, 1));
  }
  const P = objectPoints.map(([x, y]) => new THREE.Vector3(x, y, 0));
  // 模型点均值（z=0，均值 z 亦为 0）
  const Pm = new THREE.Vector3();
  for (const p of P) Pm.add(p);
  Pm.multiplyScalar(1 / P.length);

  let R = toCV(R0);
  let t = flipV(t0);
  for (let iter = 0; iter < nSteps; iter++) {
    // E 步：把当前预测点 R·p_i + t 正交投影到观测方向 v_i 上
    const qs: THREE.Vector3[] = [];
    for (let i = 0; i < P.length; i++) {
      const q = applyR(R, P[i]).add(t);
      const vv2 = v[i].dot(v[i]);
      const s = v[i].dot(q) / vv2; // 沿观测方向的比例（= 深度，CV 坐标下 z>0 在前方）
      if (s <= 1e-9) return null; // 点在相机后方
      qs.push(v[i].clone().multiplyScalar(s));
    }
    // M 步：Procrustes 求解 R、t（物方误差）
    const qm = new THREE.Vector3();
    for (const q of qs) qm.add(q);
    qm.multiplyScalar(1 / qs.length);
    const C = new THREE.Matrix3();
    const Ce = C.elements;
    for (let i = 0; i < P.length; i++) {
      const a = qs[i].clone().sub(qm);
      const b = P[i].clone().sub(Pm);
      Ce[0] += a.x * b.x;
      Ce[3] += a.x * b.y;
      Ce[6] += a.x * b.z;
      Ce[1] += a.y * b.x;
      Ce[4] += a.y * b.y;
      Ce[7] += a.y * b.z;
      Ce[2] += a.z * b.x;
      Ce[5] += a.z * b.y;
      Ce[8] += a.z * b.z;
    }
    const Rn = polarDecompose(C);
    const tn = qm.clone().sub(applyR(Rn, Pm));
    const change = matrixDist(Rn, R) + tn.distanceTo(t);
    R = Rn;
    t = tn;
    if (change < 1e-12) break;
  }
  // 转回 Three.js 坐标
  return { R: toCV(R), t: flipV(t) };
}

/** 3×3 矩阵作用于向量（Three.js 该版本 Matrix3 无 multiplyVector3） */
function applyR(R: THREE.Matrix3, v: THREE.Vector3): THREE.Vector3 {
  const e = R.elements;
  return new THREE.Vector3(
    e[0] * v.x + e[3] * v.y + e[6] * v.z,
    e[1] * v.x + e[4] * v.y + e[7] * v.z,
    e[2] * v.x + e[5] * v.y + e[8] * v.z
  );
}

/** 3×3 矩阵 Frobenius 距离（Three.js 该版本 Matrix3 无 distanceTo） */
function matrixDist(a: THREE.Matrix3, b: THREE.Matrix3): number {
  const ae = a.elements;
  const be = b.elements;
  let s = 0;
  for (let i = 0; i < 9; i++) {
    const d = ae[i] - be[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

/** 位姿参数 [wx,wy,wz,tx,ty,tz] 重投影 4 角点，返回 8 维残差 */
function computeReprojResidual(
  params: Float64Array,
  objectPoints: number[][],
  imagePoints: number[][],
  f: number,
  cx: number,
  cy: number
): number[] {
  const R = rodrigues(params[0], params[1], params[2]);
  const e = R.elements;
  const out: number[] = [];
  for (let i = 0; i < objectPoints.length; i++) {
    const wx = objectPoints[i][0];
    const wy = objectPoints[i][1];
    const camx = e[0] * wx + e[3] * wy + params[3];
    const camy = e[1] * wx + e[4] * wy + params[4];
    const camz = e[2] * wx + e[5] * wy + params[5];
    if (camz > -1e-6) {
      out.push(1e4, 1e4); // 相机后方，重罚
      continue;
    }
    out.push((f * camx) / -camz + cx - imagePoints[i][0]);
    out.push(cy + (f * camy) / camz - imagePoints[i][1]);
  }
  return out;
}

/** 求解 6x6 线性方程组 A x = b */
function solve6(A: number[][], b: number[]): number[] | null {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 6; col++) {
    let pivot = col;
    for (let r = col + 1; r < 6; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < 6; r++) {
      if (r === col) continue;
      const fct = M[r][col] / M[col][col];
      for (let c = col; c <= 6; c++) M[r][c] -= fct * M[col][c];
    }
  }
  return M.map((row, i) => row[6] / row[i]);
}

/**
 * 高斯-牛顿迭代优化位姿（PnP refine）：以初值 R0/t0 为起点，最小化 4 角点重投影误差。
 * 大角度、角点带噪声时，直接分解的位姿会明显漂移，迭代优化可大幅改善。
 */
export function refinePosePnP(
  R0: THREE.Matrix3,
  t0: THREE.Vector3,
  objectPoints: number[][],
  imagePoints: number[][],
  f: number,
  cx: number,
  cy: number
): { R: THREE.Matrix3; t: THREE.Vector3 } | null {
  const { axis, angle } = matrixToAxisAngle(R0);
  const params = new Float64Array(6);
  params[0] = axis.x * angle;
  params[1] = axis.y * angle;
  params[2] = axis.z * angle;
  params[3] = t0.x;
  params[4] = t0.y;
  params[5] = t0.z;
  const initParams = Float64Array.from(params);

  for (let iter = 0; iter < 15; iter++) {
    const r = computeReprojResidual(params, objectPoints, imagePoints, f, cx, cy);
    // 数值雅可比 6x8
    const J: number[][] = [];
    const eps = 1e-5;
    for (let k = 0; k < 6; k++) {
      const p2 = Float64Array.from(params);
      p2[k] += eps;
      const r2 = computeReprojResidual(p2, objectPoints, imagePoints, f, cx, cy);
      const col: number[] = [];
      for (let i = 0; i < r.length; i++) col.push((r2[i] - r[i]) / eps);
      J.push(col);
    }
    // 法方程 (J^T J + λI) Δ = -J^T r
    const JTJ: number[][] = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
    const JTr = new Array<number>(6).fill(0);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        let s = 0;
        for (let m = 0; m < r.length; m++) s += J[i][m] * J[j][m];
        JTJ[i][j] = s;
      }
      for (let m = 0; m < r.length; m++) JTr[i] += J[i][m] * r[m];
    }
    const lambda = 0.01;
    for (let i = 0; i < 6; i++) JTJ[i][i] += lambda;
    const delta = solve6(JTJ, JTr.map((v) => -v));
    if (!delta) return null;
    let maxStep = 0;
    for (let i = 0; i < 6; i++) maxStep = Math.max(maxStep, Math.abs(delta[i]));
    if (maxStep < 1e-8) break;
    for (let i = 0; i < 6; i++) params[i] += delta[i];
  }

  // 高斯-牛顿在接近奇异的 JTJ 上可能产生垃圾步长，把正确的 DLT 初值破坏。
  // 优化结束后对比初值/终值重投影残差，仅当优化确实改善时采用。
  const sq = (r: number[]) => r.reduce((s, v) => s + v * v, 0);
  const rFinal = computeReprojResidual(params, objectPoints, imagePoints, f, cx, cy);
  const rInit = computeReprojResidual(initParams, objectPoints, imagePoints, f, cx, cy);
  if (sq(rFinal) > sq(rInit) + 1e-6) {
    // 优化变差 → 返回初值对应的位姿（DLT 解）
    return {
      R: rodrigues(initParams[0], initParams[1], initParams[2]),
      t: new THREE.Vector3(initParams[3], initParams[4], initParams[5]),
    };
  }

  return {
    R: rodrigues(params[0], params[1], params[2]),
    t: new THREE.Vector3(params[3], params[4], params[5]),
  };
}

/**
 * 由图像中二维码的 4 个角点估算二维码平面在相机坐标系中的位姿。
 * 焦距使用固定假设（fovYDeg），无需用户校准。
 *
 * @param corners 按顺序 TL, TR, BR, BL（顺时针，从左上开始）的图像像素坐标
 * @param imageWidth  视频帧原始宽度（像素）
 * @param imageHeight 视频帧原始高度（像素）
 * @param qrSizeCm    二维码物理边长（cm）
 * @param fovYDeg     相机垂直视场角（度）固定假设值（无 focalPx 时使用）
 * @param opts        可选：focalPx 外部平滑焦距（px，优先使用）；outFocal 输出本帧自动估计的焦距
 */
export function estimateQRPose(
  corners: Array<{ x: number; y: number }>,
  imageWidth: number,
  imageHeight: number,
  qrSizeCm: number,
  fovYDeg: number,
  opts?: { focalPx?: number; outFocal?: { value: number } }
): QRPose | null {
  if (!corners || corners.length !== 4) return null;
  const s = qrSizeCm;
  // src 的 Y+ 指向二维码"上"方向（TL 侧）：这样解出的 e2 = 二维码平面内向上方向，
  // 与 AR 模型卡片中轴（局部 +Y）一致。若 Y 取反，e2 会指向二维码下方，模型上下颠倒。
  const src = [
    [-s / 2, s / 2],
    [s / 2, s / 2],
    [s / 2, -s / 2],
    [-s / 2, -s / 2],
  ];
  const dst = corners.map((p) => [p.x, p.y]);
  const h = solveHomographyDLT(src, dst);
  if (!h) return null;

  // 相机内参：主点在画面中心
  const cx = imageWidth / 2;
  const cy = imageHeight / 2;
  const fDefault = imageHeight / 2 / Math.tan((fovYDeg * Math.PI) / 360);

  // 自动焦距估计：二维码为已知正方形，其平面基向量应正交（r1⊥r2）且等长，
  // 由 r1 = K⁻¹h1、r2 = K⁻¹h2 展开求解焦距 f（含主点偏移），无需用户标定。
  let fEst = 0;
  const a1 = h[0] - cx * h[6]; // h11 - cx·h31
  const b1 = h[3] - cy * h[6]; // h21 - cy·h31
  const a2 = h[1] - cx * h[7]; // h12 - cx·h32
  const b2 = h[4] - cy * h[7]; // h22 - cy·h32
  const clampF = (f2: number) => {
    if (!isFinite(f2) || f2 <= 0) return 0;
    const fv = Math.sqrt(f2);
    const minF = imageWidth * 0.25;
    const maxF = imageWidth * 4;
    return fv >= minF && fv <= maxF ? fv : 0;
  };
  // 正交：r1·r2 = 0 → f² = -(a1·a2 + b1·b2)/(h31·h32)
  const denOrth = h[6] * h[7];
  if (Math.abs(denOrth) > 1e-9) {
    const fOrth = clampF(-(a1 * a2 + b1 * b2) / denOrth);
    if (fOrth > 0) fEst = fOrth;
  }
  // 等长：|r1|²=|r2|² → f² = (a2²+b2²-a1²-b1²)/(h31²-h32²)
  if (fEst === 0) {
    const denEq = h[6] * h[6] - h[7] * h[7];
    if (Math.abs(denEq) > 1e-9) {
      const fEq = clampF((a2 * a2 + b2 * b2 - a1 * a1 - b1 * b1) / denEq);
      if (fEq > 0) fEst = fEq;
    }
  }
  if (opts?.outFocal) opts.outFocal.value = fEst || fDefault;
  const f = opts?.focalPx && opts.focalPx > 0 ? opts.focalPx : fEst || fDefault;

  // G = K^{-1} * H，行主序
  const g = [
    h[0] / f - (cx * h[6]) / f,
    h[1] / f - (cx * h[7]) / f,
    h[2] / f - (cx * h[8]) / f,
    h[3] / f - (cy * h[6]) / f,
    h[4] / f - (cy * h[7]) / f,
    h[5] / f - (cy * h[8]) / f,
    h[6],
    h[7],
    h[8],
  ];

  // 取列向量（此时位于“计算机视觉相机坐标”：图像 y 向下、+Z 向前）
  let r1 = new THREE.Vector3(g[0], g[3], g[6]);
  let r2 = new THREE.Vector3(g[1], g[4], g[7]);
  let t = new THREE.Vector3(g[2], g[5], g[8]);

  // CV 相机坐标 -> Three.js 场景坐标（+Y 向上、-Z 向前）：
  // 图像 y 向下对应 Three.js -Y；相机前方 +Z 对应 Three.js -Z。
  const flipCVtoThree = (v: THREE.Vector3) => new THREE.Vector3(v.x, -v.y, -v.z);
  r1 = flipCVtoThree(r1);
  r2 = flipCVtoThree(r2);
  t = flipCVtoThree(t);

  const scale = (r1.length() + r2.length()) / 2;
  if (scale < 1e-9) return null;
  r1.divideScalar(scale);
  r2.divideScalar(scale);
  t.divideScalar(scale);

  // 二维码应在相机前方：Three.js 中相机朝向 -Z，故 t.z < 0
  if (t.z > 0) {
    r1.multiplyScalar(-1);
    r2.multiplyScalar(-1);
    t.multiplyScalar(-1);
  }

  // 极分解正交化（AprilTag 同款 SVD 极分解，替代 Gram-Schmidt）：
  // 先构造 R = [r1 r2 r3]（r3 = r1×r2），再整体投影到最近的 SO(3) 旋转。
  // 大透视/角点噪声下，整矩阵的全局最优正交化比串行 Gram-Schmidt 更稳定。
  const r3raw = new THREE.Vector3().crossVectors(r1, r2);
  const Rraw = new THREE.Matrix3().set(
    r1.x, r2.x, r3raw.x,
    r1.y, r2.y, r3raw.y,
    r1.z, r2.z, r3raw.z
  );
  const Rorth = polarDecompose(Rraw);
  const Re = Rorth.elements;
  const e1 = new THREE.Vector3(Re[0], Re[1], Re[2]);
  const e2 = new THREE.Vector3(Re[3], Re[4], Re[5]);
  const e3 = new THREE.Vector3(Re[6], Re[7], Re[8]);
  // 法线应朝向相机半球（二维码正面朝向相机）：
  // 不能用 e3.z>0 判定——二维码平放桌面时法线朝上(z≈0)，按 z 判定会误翻成朝下。
  const toCameraDir = t.clone().negate().normalize();
  if (e3.dot(toCameraDir) < 0) e3.multiplyScalar(-1);

  const R0 = new THREE.Matrix3().set(
    e1.x, e2.x, e3.x,
    e1.y, e2.y, e3.y,
    e1.z, e2.z, e3.z
  );

  // 高斯-牛顿 PnP 精化（像素域误差，无噪声时精确；大透视下比正交迭代更准）。
  // 仅当优化后的重投影误差不差于初值时才采用，否则退回极分解的 DLT 解。
  const refined = refinePosePnP(R0, t, src, dst, f, cx, cy);
  if (refined) {
    const re = refined.R.elements;
    const re1 = new THREE.Vector3(re[0], re[1], re[2]);
    const re2 = new THREE.Vector3(re[3], re[4], re[5]);
    let re3 = new THREE.Vector3(re[6], re[7], re[8]);
    if (re3.dot(toCameraDir) < 0) re3.multiplyScalar(-1);
    if (reprojError(refined.R, refined.t, src, dst, f, cx, cy) <= reprojError(R0, t, src, dst, f, cx, cy) + 1e-6) {
      return {
        valid: true,
        position: refined.t,
        quaternion: new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(re1, re2, re3)
        ),
        normal: re3,
      };
    }
  }

  // 若 PnP 退化（如完全正对时的奇异 JTJ），正交迭代作兜底（物方误差，无数值雅可比）。
  const fallback = orthogonalIteration(src, dst, f, f, cx, cy, R0, t);
  if (fallback) {
    const re = fallback.R.elements;
    const re1 = new THREE.Vector3(re[0], re[1], re[2]);
    const re2 = new THREE.Vector3(re[3], re[4], re[5]);
    let re3 = new THREE.Vector3(re[6], re[7], re[8]);
    if (re3.dot(toCameraDir) < 0) re3.multiplyScalar(-1);
    return {
      valid: true,
      position: fallback.t,
      quaternion: new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(re1, re2, re3)
      ),
      normal: re3,
    };
  }

  return {
    valid: true,
    position: t,
    quaternion: new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(e1, e2, e3)
    ),
    normal: e3,
  };
}

/** 像素域重投影误差平方和（用于正交迭代结果的取舍判定） */
function reprojError(
  R: THREE.Matrix3,
  t: THREE.Vector3,
  objectPoints: number[][],
  imagePoints: number[][],
  f: number,
  cx: number,
  cy: number
): number {
  const e = R.elements;
  let sum = 0;
  for (let i = 0; i < objectPoints.length; i++) {
    const [X, Y] = objectPoints[i];
    const camx = e[0] * X + e[3] * Y + t.x;
    const camy = e[1] * X + e[4] * Y + t.y;
    const camz = e[2] * X + e[5] * Y + t.z;
    if (camz > -1e-6) return Infinity; // 相机后方
    const u = (f * camx) / -camz + cx;
    const v = cy + (f * camy) / camz;
    sum += (u - imagePoints[i][0]) * (u - imagePoints[i][0]) + (v - imagePoints[i][1]) * (v - imagePoints[i][1]);
  }
  return sum;
}
