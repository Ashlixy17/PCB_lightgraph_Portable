import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { X, ScanLine, VideoOff, RefreshCw, RotateCw } from 'lucide-react';
import { estimateQRPose, QRPose } from '../utils/qrPose';
import { detectAprilTags, initAprilTag } from '../utils/apriltagDetector';
import { AR_APRILTAG_ID } from '../utils/apriltagGen';
import { CARD_W3D, CARD_H3D } from '../utils/diecutShape';
import { createAcrylicRefractionMaterial } from '../utils/acrylicRefraction';

export type ARAxisMode = 'normal' | 'plane';

interface ARPreviewOverlayProps {
  passGroup: THREE.Group | null;
  qrSizeCm: number;
  thickness: number;
  autoRotate: boolean;
  /** 模型旋转轴：'normal' 绕 AprilTag 法线（竖着转），'plane' 绕平面内轴（躺着转） */
  rotateAxis: ARAxisMode;
  /** 躺着转时旋转轴在 AprilTag 平面内的角度（度，0-360，0 = 沿 e1，90 = 沿 e2） */
  planeAngle: number;
  onClose: () => void;
}

const CAMERA_FOV = 45; // 固定垂直视场角假设（无需校准），位姿估算与渲染相机一致
const DETECT_INTERVAL = 150; // 检测间隔 ms
const MAX_SCAN = 1120; // AprilTag 检测的最大扫描宽度（分辨率越高，远处/小锚点越容易识别）
const ROTATE_SPEED = 0.006; // 自动旋转角速度（与主预览一致）
const SMOOTH = 1.0; // 关闭位置/角度/大小平滑，直接跟随最新识别位姿
const IDENTITY_QUAT = new THREE.Quaternion(); // 单位四元数（axisGroup 竖转模式目标，只读复用）

type StatusKind = 'starting' | 'searching' | 'mismatch' | 'locked' | 'error';

/**
 * 角点指数平滑（减少 AprilTag 检测的帧间抖动）。
 * 若锚点像素尺寸突变（>50%，视为跳变/重扫），直接重置平滑器。
 */
function smoothCorners(
  raw: Array<{ x: number; y: number }>,
  prev: Array<{ x: number; y: number }> | null
): Array<{ x: number; y: number }> {
  if (!prev) return raw.map((c) => ({ x: c.x, y: c.y }));
  const diag = (c: Array<{ x: number; y: number }>) =>
    Math.hypot(c[2].x - c[0].x, c[2].y - c[0].y);
  const d = diag(raw);
  const pd = diag(prev);
  if (pd > 1e-6 && Math.abs(d - pd) / pd > 0.5) {
    return raw.map((c) => ({ x: c.x, y: c.y }));
  }
  const alpha = 0.5; // 平滑系数（越大越贴近最新检测，越小越稳）
  return raw.map((c, i) => ({
    x: prev[i].x + (c.x - prev[i].x) * alpha,
    y: prev[i].y + (c.y - prev[i].y) * alpha,
  }));
}

/**
 * 摄像头 AR：识别 AprilTag 锚点后把通行证 3D 模型"立"在锚点平面上。
 * - 通过单应矩阵估算锚点平面位姿（固定焦距假设），模型底面贴合锚点平面
 * - 透视渲染 3D 模型，支持按配置自动旋转与拖动旋转（旋转轴可选：法线竖转 / 平面内躺转）
 */
export const ARPreviewOverlay: React.FC<ARPreviewOverlayProps> = ({
  passGroup,
  qrSizeCm,
  thickness,
  autoRotate,
  rotateAxis,
  planeAngle,
  onClose,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const closedRef = useRef<boolean>(false);

  // Three.js（透视相机）
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const anchorGroupRef = useRef<THREE.Group | null>(null); // 贴合 AprilTag 的锚点组
  const axisGroupRef = useRef<THREE.Group | null>(null); // 旋转轴切换：法线(竖转)/平面内(躺转)
  const spinGroupRef = useRef<THREE.Group | null>(null); // 自动/拖动旋转
  const modelRef = useRef<THREE.Group | null>(null);
  const frameRef = useRef<THREE.LineSegments | null>(null); // 框住 AprilTag 的空间框（右下角切角指示方向）
  const rafRef = useRef<number | null>(null);
  const targetPoseRef = useRef<{ position: THREE.Vector3; quaternion: THREE.Quaternion; scale: number }>({
    position: new THREE.Vector3(0, 0, 0),
    quaternion: new THREE.Quaternion(),
    scale: 0,
  });

  // 位姿稳定性：角点平滑
  const smoothCornersRef = useRef<Array<{ x: number; y: number }> | null>(null);
  const focalPxRef = useRef<number>(0); // 自动标定的相机焦距（px），0 = 未标定（使用默认 fov）

  // 摄像头 / 检测
  const streamRef = useRef<MediaStream | null>(null);
  const scanCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<number | null>(null);
  const detectBusyRef = useRef<boolean>(false);
  const lastDetectRef = useRef<number>(0);
  const qrSizeCmRef = useRef<number>(qrSizeCm);
  qrSizeCmRef.current = qrSizeCm;

  // 旋转控制
  const autoRotateRef = useRef<boolean>(autoRotate);
  const rotateAxisRef = useRef<ARAxisMode>(rotateAxis);
  rotateAxisRef.current = rotateAxis;
  const planeAngleRef = useRef<number>(planeAngle);
  planeAngleRef.current = planeAngle;
  const draggingRef = useRef<boolean>(false);
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const [status, setStatus] = useState<StatusKind>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [arAutoRotate, setArAutoRotate] = useState<boolean>(autoRotate);
  autoRotateRef.current = arAutoRotate;

  // ---------- 初始化：摄像头 + 检测器 + 3D 场景 ----------
  useEffect(() => {
    let active = true;
    let resizeHandler: (() => void) | null = null;
    let pointerCleanup: (() => void) | null = null;
    let arAcrylic: THREE.Mesh | null = null;
    let arPrintMeshes: THREE.Mesh[] = [];
    let arOuterPrints: THREE.Mesh[] = [];
    let arInnerPrints: THREE.Mesh[] = [];
    let arDefaultMaterials: THREE.Material[] | null = null;
    let arRefractionMaterials: THREE.Material[] | null = null;
    let arBackfaceMaterial: THREE.ShaderMaterial | null = null;
    let arEnvRT: THREE.WebGLRenderTarget | null = null;
    let arBackfaceRT: THREE.WebGLRenderTarget | null = null;

    const disposeAll = () => {
      active = false;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (frameRef.current) {
        frameRef.current.geometry.dispose();
        (frameRef.current.material as THREE.Material).dispose();
        frameRef.current.removeFromParent();
        frameRef.current = null;
      }
      if (rendererRef.current) {
        rendererRef.current.dispose();
        if (rendererRef.current.domElement.parentElement) {
          rendererRef.current.domElement.parentElement.removeChild(rendererRef.current.domElement);
        }
        rendererRef.current = null;
      }
      arEnvRT?.dispose();
      arBackfaceRT?.dispose();
      arBackfaceMaterial?.dispose();
      if (arRefractionMaterials) {
        arRefractionMaterials.forEach((material, index) => {
          if (index === 0 || material !== arRefractionMaterials?.[0]) material.dispose();
        });
      }
      arEnvRT = null;
      arBackfaceRT = null;
      arBackfaceMaterial = null;
      arRefractionMaterials = null;
      if (resizeHandler) window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
      if (pointerCleanup) pointerCleanup();
      pointerCleanup = null;
    };

    (async () => {
      const video = videoRef.current;
      if (!video) return;

      // 优先后置摄像头（environment），失败后回退默认摄像头
      try {
        await navigator.mediaDevices
          .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
          .then((stream) => {
            streamRef.current = stream;
            video.srcObject = stream;
            return video.play();
          });
      } catch (err) {
        if (!active) return;
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();
      }
      if (!active) return;
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await new Promise<void>((resolve) => {
          const onReady = () => {
            video.removeEventListener('loadeddata', onReady);
            resolve();
          };
          video.addEventListener('loadeddata', onReady, { once: true });
        });
      }

      setCameraError(null);

      // 预加载 AprilTag wasm 检测器（避免首帧检测等待 wasm 加载/编译）
      try {
        await initAprilTag();
      } catch (err) {
        console.warn('AprilTag wasm 预加载失败，检测循环将继续重试:', err);
      }

      // 3D 场景初始化（AprilTag wasm 检测器在使用时懒加载）
      // 初始化 3D 场景
      const scene = new THREE.Scene();
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(
        CAMERA_FOV,
        (video.videoWidth || 1) / (video.videoHeight || 1),
        0.1,
        500
      );
      cameraRef.current = camera;

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        premultipliedAlpha: false,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.autoClear = false;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.style.position = 'absolute';
      renderer.domElement.style.inset = '0';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.cursor = 'grab';
      renderer.domElement.style.touchAction = 'none';
      viewportRef.current?.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // 灯光
      const ambient = new THREE.AmbientLight(0xffffff, 1.0);
      scene.add(ambient);
      const hemi = new THREE.HemisphereLight(0xffffff, 0x8899bb, 0.6);
      scene.add(hemi);
      const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
      dirLight.position.set(3, 5, 4);
      scene.add(dirLight);
      const dirLight2 = new THREE.DirectionalLight(0xbbe1ff, 0.6);
      dirLight2.position.set(-4, 2, 3);
      scene.add(dirLight2);

      // 模型层级：anchorGroup(贴合 AprilTag) -> axisGroup(旋转轴切换) -> spinGroup(旋转) -> 模型
      // anchorGroup 本地坐标：+X=e2(平面内)、+Y=e3(法线/竖直)、+Z=e1(平面内面朝固定方向)。
      // 模型长轴沿本地 +Y 抬升 → 卡片竖直立在锚点上、面朝固定方向，不跟随摄像机。
      // axisGroup 单位四元数 → spin 绕法线 e3（竖着旋转，转盘式）；
      // Euler(-90°, planeAngle, 0, 'YXZ') → spin 绕平面内轴（躺着旋转，翻书式），
      // 旋转轴方向 = sin(planeAngle)·e2 + cos(planeAngle)·e1（planeAngle=0 沿 e1，90 沿 e2）。
      const anchorGroup = new THREE.Group();
      scene.add(anchorGroup);
      anchorGroupRef.current = anchorGroup;
      const axisGroup = new THREE.Group();
      anchorGroup.add(axisGroup);
      axisGroupRef.current = axisGroup;
      if (rotateAxisRef.current === 'plane') {
        axisGroup.quaternion.setFromEuler(
          new THREE.Euler(-Math.PI / 2, (planeAngleRef.current * Math.PI) / 180, 0, 'YXZ')
        );
      }
      const spinGroup = new THREE.Group();
      axisGroup.add(spinGroup);
      spinGroupRef.current = spinGroup;

      if (passGroup) {
        const model = passGroup.clone(true);
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.visible = true;
          const layer = object.userData.printLayer;
          if (layer === 'frontOuter' || layer === 'backOuter') arOuterPrints.push(object);
          if (layer === 'frontInner' || layer === 'backInner') arInnerPrints.push(object);
          if (object.userData.isAcrylicBody) arAcrylic = object;
        });
        arPrintMeshes = [...arOuterPrints, ...arInnerPrints];
        if (arAcrylic) {
          const mats = Array.isArray(arAcrylic.material) ? arAcrylic.material : [];
          arDefaultMaterials = mats;
          arEnvRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, stencilBuffer: false });
          arBackfaceRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, stencilBuffer: false });
          arEnvRT.texture.colorSpace = THREE.SRGBColorSpace;
          arBackfaceRT.texture.colorSpace = THREE.NoColorSpace;
          arBackfaceMaterial = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: true,
            toneMapped: false,
            vertexShader: `
              varying vec3 vBackfaceNormal;
              void main() {
                vBackfaceNormal = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              }
            `,
            fragmentShader: `
              varying vec3 vBackfaceNormal;
              void main() {
                gl_FragColor = vec4(normalize(vBackfaceNormal) * 0.5 + 0.5, 1.0);
              }
            `,
          });
          const cap = createAcrylicRefractionMaterial({
            envMap: arEnvRT.texture,
            backfaceMap: arBackfaceRT.texture,
            frost: 0,
            refractionStrength: 0.72,
            thickness,
          });
          const side = createAcrylicRefractionMaterial({
            envMap: arEnvRT.texture,
            backfaceMap: arBackfaceRT.texture,
            frost: 0.2,
            transmission: 0.75,
            refractionStrength: 0.32,
            thickness,
          });
          arRefractionMaterials = [cap, side, cap];
        }
        model.visible = false;
        spinGroup.add(model);
        modelRef.current = model;
      }

      // AprilTag 空间框：LineSegments 画锚点四边，右下角切角（斜线）指示方向
      const frameGeo = new THREE.BufferGeometry();
      frameGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(10 * 3), 3));
      const frameMat = new THREE.LineBasicMaterial({
        color: 0x22e0c0,
        transparent: true,
        opacity: 0.95,
      });
      const frame = new THREE.LineSegments(frameGeo, frameMat);
      frame.visible = false;
      frame.frustumCulled = false;
      scene.add(frame);
      frameRef.current = frame;

      // 更新空间框：贴合 AprilTag 四边（尺寸 = qrSizeCm），右下角切角表示方向
      const updateFrame = (pose: QRPose) => {
        const f = frameRef.current;
        if (!f) return;
        // 场景单位 = cm（模型 scale = qrSizeCm/CARD_W3D，1 单位 = 1cm），
        // 故半边长直接用 qrSizeCm/2
        const half = qrSizeCmRef.current / 2;
        const cut = Math.max(0.02, half * 0.35); // 右下角切角长度
        // pose 局部 +Y（e2）= 二维码平面内"向上"方向（内容正读方向），
        // 因此 sy=+1 是上侧（TL/TR），sy=-1 是下侧（BR/BL）。
        const e1 = new THREE.Vector3(1, 0, 0).applyQuaternion(pose.quaternion);
        const e2 = new THREE.Vector3(0, 1, 0).applyQuaternion(pose.quaternion);
        const c = pose.position;
        const corner = (sx: number, sy: number) =>
          c.clone().addScaledVector(e1, sx * half).addScaledVector(e2, sy * half);
        const TL = corner(-1, 1);
        const TR = corner(1, 1);
        const BR = corner(1, -1);
        const BL = corner(-1, -1);
        // 切角在右下角 BR：沿 BR 的两条邻边（-e1 向左、+e2 向上）各取 cut
        const A = BR.clone().addScaledVector(e1, -cut);
        const B = BR.clone().addScaledVector(e2, cut);
        const attr = f.geometry.getAttribute('position') as THREE.BufferAttribute;
        const arr = [
          TL.x, TL.y, TL.z, TR.x, TR.y, TR.z,
          TR.x, TR.y, TR.z, BR.x, BR.y, BR.z,
          BR.x, BR.y, BR.z, BL.x, BL.y, BL.z,
          BL.x, BL.y, BL.z, TL.x, TL.y, TL.z,
          A.x, A.y, A.z, B.x, B.y, B.z,
        ];
        arr.forEach((v, i) => { attr.array[i] = v; });
        attr.needsUpdate = true;
        f.visible = true;
      };

      // 按 AprilTag 位姿放置锚点：模型固定在锚点上（不随相机转动）。
      // 模型局部坐标：+Y=卡片长轴/抬高方向，+Z=卡片面法线。
      // - 长轴 → 锚点法线 e3：卡片竖直立在锚点上（底部贴锚点中心）
      // - 面法线 → 锚点平面内 e1：面朝固定方向，移动摄像头时能看到卡片不同角度
      const applyPose = (pose: QRPose) => {
        const model = modelRef.current;
        if (!model) return;
        // 只记录目标值，位置/角度/大小统一在渲染循环里平滑逼近
        targetPoseRef.current.scale = qrSizeCmRef.current / CARD_W3D;

        const e1 = new THREE.Vector3(1, 0, 0).applyQuaternion(pose.quaternion);
        const e2 = new THREE.Vector3(0, 1, 0).applyQuaternion(pose.quaternion);
        const e3 = new THREE.Vector3(0, 0, 1).applyQuaternion(pose.quaternion);
        // makeBasis(xAxis, yAxis, zAxis)：局部 X→e2、Y→e3（竖直）、Z→e1（固定朝向）
        const rot = new THREE.Matrix4().makeBasis(e2, e3, e1);

        targetPoseRef.current.position.copy(pose.position);
        targetPoseRef.current.quaternion.setFromRotationMatrix(rot);
        model.visible = true;
        updateFrame(pose);
      };

      resizeHandler = () => {
        const root = rootRef.current;
        const viewport = viewportRef.current;
        if (!root || !viewport || !rendererRef.current || !cameraRef.current) return;
        const vw = video.videoWidth || 1;
        const vh = video.videoHeight || 1;
        const scale = Math.min(root.clientWidth / vw, root.clientHeight / vh);
        const w = Math.max(1, Math.floor(vw * scale));
        const h = Math.max(1, Math.floor(vh * scale));
        viewport.style.width = `${w}px`;
        viewport.style.height = `${h}px`;
        rendererRef.current.setSize(w, h);
        cameraRef.current.aspect = vw / vh;
        cameraRef.current.updateProjectionMatrix();
      };
      resizeHandler();
      window.addEventListener('resize', resizeHandler);
      if (!active) {
        disposeAll();
        return;
      }

      // 拖动旋转（拖拽模型本身，保持锚定在二维码上）
      const canvas = renderer.domElement;
      const onPointerDown = (e: PointerEvent) => {
        draggingRef.current = true;
        lastPointerRef.current = { x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'grabbing';
      };
      const onPointerMove = (e: PointerEvent) => {
        if (!draggingRef.current) return;
        const dx = e.clientX - lastPointerRef.current.x;
        const dy = e.clientY - lastPointerRef.current.y;
        lastPointerRef.current = { x: e.clientX, y: e.clientY };
        const spin = spinGroupRef.current;
        if (!spin) return;
        spin.rotation.y -= dx * 0.01;
        spin.rotation.x = THREE.MathUtils.clamp(spin.rotation.x - dy * 0.01, -1.2, 1.2);
      };
      const onPointerUp = () => {
        draggingRef.current = false;
        canvas.style.cursor = 'grab';
      };
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);
      pointerCleanup = () => {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
      };

      const renderARFrame = () => {
        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        const model = modelRef.current;
        if (!renderer || !scene || !camera || !model || !arAcrylic || !arEnvRT || !arBackfaceRT || !arRefractionMaterials || !arBackfaceMaterial) {
          renderer?.setRenderTarget(null);
          renderer?.clear();
          if (scene && camera) renderer?.render(scene, camera);
          return;
        }

        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        const w = Math.max(1, Math.floor(size.x));
        const h = Math.max(1, Math.floor(size.y));
        if (arEnvRT.width !== w || arEnvRT.height !== h) {
          arEnvRT.setSize(w, h);
          arBackfaceRT.setSize(w, h);
        }
        const projectionScale = new THREE.Vector2(
          camera.projectionMatrix.elements[0],
          camera.projectionMatrix.elements[5],
        );
        const cap = arRefractionMaterials[0] as THREE.ShaderMaterial;
        const side = arRefractionMaterials[1] as THREE.ShaderMaterial;
        cap.uniforms.resolution.value.copy(size);
        side.uniforms.resolution.value.copy(size);
        cap.uniforms.projectionScale.value.copy(projectionScale);
        side.uniforms.projectionScale.value.copy(projectionScale);

        const frameVisible = frameRef.current?.visible ?? false;
        if (frameRef.current) frameRef.current.visible = false;
        model.visible = true;

        // Pass A: inner prints become the refracted scene.
        arAcrylic.visible = false;
        arOuterPrints.forEach((mesh) => (mesh.visible = false));
        arInnerPrints.forEach((mesh) => (mesh.visible = true));
        renderer.setRenderTarget(arEnvRT);
        renderer.clear();
        renderer.render(scene, camera);

        // Pass B: encode the acrylic back-face normal.
        arInnerPrints.forEach((mesh) => (mesh.visible = false));
        arAcrylic.visible = true;
        arAcrylic.material = arBackfaceMaterial;
        renderer.setRenderTarget(arBackfaceRT);
        renderer.clear();
        renderer.render(scene, camera);

        // Pass C: same ordering as the desktop 3D preview.
        arAcrylic.visible = false;
        arInnerPrints.forEach((mesh) => (mesh.visible = true));
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(scene, camera);

        arAcrylic.visible = true;
        arAcrylic.material = arRefractionMaterials;
        renderer.render(scene, camera);

        arAcrylic.visible = false;
        arInnerPrints.forEach((mesh) => (mesh.visible = false));
        arOuterPrints.forEach((mesh) => (mesh.visible = true));
        if (frameRef.current) frameRef.current.visible = frameVisible;
        renderer.render(scene, camera);

        if (arDefaultMaterials) arAcrylic.material = arDefaultMaterials;
        arAcrylic.visible = true;
        arPrintMeshes.forEach((mesh) => (mesh.visible = true));
        if (frameRef.current) frameRef.current.visible = frameVisible;
      };

      // 渲染循环：锚点平滑跟随 + 模型大小平滑 + 自动旋转
      const axisTargetQuat = new THREE.Quaternion(); // 躺转模式的 axisGroup 目标朝向（复用，避免每帧分配）
      const tick = () => {
        rafRef.current = requestAnimationFrame(tick);
        const anchor = anchorGroupRef.current;
        if (anchor) {
          anchor.position.lerp(targetPoseRef.current.position, SMOOTH);
          anchor.quaternion.slerp(targetPoseRef.current.quaternion, SMOOTH);
        }
        const model = modelRef.current;
        if (model && model.visible) {
          // 大小平滑逼近目标
          const targetScale = targetPoseRef.current.scale;
          const curScale = model.scale.x;
          const ns = curScale + (targetScale - curScale) * SMOOTH;
          model.scale.setScalar(ns);
          // 模型局部原点在卡面中心，抬高半卡高使底边落在锚点原点（二维码中心）
          model.position.set(0, (CARD_H3D / 2) * ns, 0);
        }
        const spin = spinGroupRef.current;
        // 旋转轴切换：'plane' 时 axisGroup 用 Euler('YXZ') 组合 —— 先绕法线转 planeAngle，
        // 再绕平面内轴转 -90°，使 spin 的旋转轴落在 AprilTag 平面内、与 e1 夹角为 planeAngle
        const axis = axisGroupRef.current;
        if (axis) {
          if (rotateAxisRef.current === 'plane') {
            axisTargetQuat.setFromEuler(
              new THREE.Euler(-Math.PI / 2, (planeAngleRef.current * Math.PI) / 180, 0, 'YXZ')
            );
            axis.quaternion.slerp(axisTargetQuat, 0.3);
          } else {
            axis.quaternion.slerp(IDENTITY_QUAT, 0.3);
          }
        }
        if (spin && autoRotateRef.current && !draggingRef.current) {
          spin.rotation.y += ROTATE_SPEED;
        }
        // 相机 fov 跟随自动标定的焦距，使 3D 透视与真实相机一致（框/模型贴合二维码）
        if (cameraRef.current && focalPxRef.current > 0) {
          const vh = videoRef.current?.videoHeight || 0;
          if (vh > 0) {
            const fovDeg = (2 * Math.atan(vh / 2 / focalPxRef.current) * 180) / Math.PI;
            if (Math.abs(cameraRef.current.fov - fovDeg) > 0.05) {
              cameraRef.current.fov = fovDeg;
              cameraRef.current.updateProjectionMatrix();
            }
          }
        }
        renderARFrame();
      };
      tick();

      // 检测循环
      const detectOnce = async (): Promise<{ kind: 'match' | 'other' | 'none'; pose?: QRPose }> => {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) return { kind: 'none' };
        // 角点平滑 + 位姿求解（AprilTag 角点顺序 [BL,BR,TR,TL] 已归一化为 [TL,TR,BR,BL]）
        const refinePose = (cornersRaw: Array<{ x: number; y: number }>): QRPose | null => {
          // 丢失过久（>800ms）则重置平滑器
          if (Date.now() - lastDetectRef.current > 800) {
            smoothCornersRef.current = null;
          }
          const sm = smoothCorners(cornersRaw, smoothCornersRef.current);
          smoothCornersRef.current = sm;
          // 自动标定焦距（AprilTag 为已知正方形，正交约束），并对焦距做跨帧 EMA
          const outFocal = { value: 0 };
          const pose = estimateQRPose(sm, vw, vh, qrSizeCmRef.current, CAMERA_FOV, {
            focalPx: focalPxRef.current,
            outFocal,
          });
          if (outFocal.value > 0) {
            focalPxRef.current =
              focalPxRef.current > 0
                ? focalPxRef.current + (outFocal.value - focalPxRef.current) * 0.3
                : outFocal.value;
          }
          return pose;
        };

        // AprilTag 检测（固定 tag36h11 家族，id=AR_APRILTAG_ID，抗光照/反光/非纯黑白）。
        // wasm 检测器懒加载，加载失败时本次检测返回 none（下帧重试）。
        try {
          const scan =
            scanCanvasRef.current || (scanCanvasRef.current = document.createElement('canvas'));
          const ctx = scan.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            const maxW = MAX_SCAN;
            const scale = Math.min(1, maxW / vw);
            scan.width = Math.max(1, Math.floor(vw * scale));
            scan.height = Math.max(1, Math.floor(vh * scale));
            ctx.drawImage(video, 0, 0, scan.width, scan.height);
            const img = ctx.getImageData(0, 0, scan.width, scan.height);
            const gray = new Uint8Array(scan.width * scan.height);
            for (let i = 0, j = 0; i < img.data.length; i += 4, j++) {
              gray[j] = (img.data[i] + 2 * img.data[i + 1] + img.data[i + 2]) >> 2;
            }
            const dets = await detectAprilTags(gray, scan.width, scan.height);
            if (dets && dets.length > 0) {
              const det = dets.find((d) => d.id === AR_APRILTAG_ID) || dets[0];
              // AprilTag 角点顺序 [BL, BR, TR, TL] → estimateQRPose 需要的 [TL, TR, BR, BL]
              const corners = [det.corners[3], det.corners[2], det.corners[1], det.corners[0]].map(
                (p) => ({ x: p.x / scale, y: p.y / scale })
              );
              const pose = refinePose(corners);
              if (pose) return { kind: 'match', pose };
            }
          }
        } catch (err) {
          // AprilTag wasm 未加载或检测异常，本次忽略
        }
        return { kind: 'none' };
      };

      const detectLoop = async () => {
        if (detectBusyRef.current) return;
        detectBusyRef.current = true;
        try {
        const result = await detectOnce();
        if (!active || closedRef.current) return;
        if (result.kind === 'match' && result.pose) {
          lastDetectRef.current = Date.now();
          applyPose(result.pose);
          setStatus('locked');
        } else {
          setStatus((s) => {
            if (s === 'locked') {
              return Date.now() - lastDetectRef.current < 1500 ? 'locked' : 'searching';
            }
            return 'searching';
          });
        }
        } finally {
          detectBusyRef.current = false;
        }
      };
      intervalRef.current = window.setInterval(detectLoop, DETECT_INTERVAL);

      setStatus('searching');
    })().catch((err: any) => {
      console.error('摄像头初始化失败:', err);
      if (!active || closedRef.current) return;
      setCameraError(
        err?.name === 'NotAllowedError'
          ? '摄像头权限被拒绝，请在浏览器设置中允许访问摄像头'
          : '无法访问摄像头，请检查设备连接与浏览器权限'
      );
      setStatus('error');
    });

    return disposeAll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 扫不到二维码（退出 locked 状态）时隐藏模型与空间框，避免悬浮在画面上
  useEffect(() => {
    const visible = status === 'locked';
    if (modelRef.current) modelRef.current.visible = visible;
    if (frameRef.current) frameRef.current.visible = visible;
  }, [status]);

  // 全屏进入/退出
  useEffect(() => {
    const root = rootRef.current;
    if (root && root.requestFullscreen && !document.fullscreenElement) {
      root.requestFullscreen().catch(() => {});
    }
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && !closedRef.current) {
        onClose();
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    closedRef.current = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    onClose();
  };

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center overflow-hidden"
    >
      {/* 视频 + WebGL 画布（保持视频原始宽高比居中） */}
      <div ref={viewportRef} className="relative">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-fill"
        />
        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-300">
            <VideoOff className="w-10 h-10 text-red-400" />
            <p className="text-sm">{cameraError || '摄像头不可用'}</p>
            <button
              onClick={handleClose}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs hover:bg-slate-700"
            >
              关闭
            </button>
          </div>
        )}
      </div>

      {/* 顶部工具栏 */}
      <div className="absolute top-0 inset-x-0 p-3 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm text-slate-200 text-xs">
          {status === 'starting' && <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />}
          {status === 'locked' && <span className="w-2 h-2 rounded-full bg-green-400" />}
          {(status === 'searching' || status === 'mismatch') && (
            <ScanLine className="w-3.5 h-3.5 text-amber-400" />
          )}
          {status === 'error' && <VideoOff className="w-3.5 h-3.5 text-red-400" />}
          <span className="font-medium">
            {status === 'starting' && '正在启动摄像头'}
            {status === 'searching' && '正在寻找 AprilTag 锚点'}
            {status === 'locked' && '已识别到 AprilTag'}
            {status === 'error' && '摄像头启动失败'}
          </span>
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            onClick={() => setArAutoRotate((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold backdrop-blur-sm transition ${
              arAutoRotate
                ? 'bg-blue-600 text-white shadow'
                : 'bg-black/60 text-slate-300 hover:text-white'
            }`}
            title={arAutoRotate ? '停止自动旋转' : '开启自动旋转'}
          >
            <RotateCw
              className={`w-4 h-4 ${arAutoRotate ? 'animate-spin [animation-duration:8s]' : ''}`}
            />
            {arAutoRotate ? '自动旋转中' : '已暂停旋转'}
          </button>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg bg-black/60 backdrop-blur-sm text-slate-200 hover:bg-black/80 hover:text-white transition"
            title="关闭摄像头"
            aria-label="关闭摄像头"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
