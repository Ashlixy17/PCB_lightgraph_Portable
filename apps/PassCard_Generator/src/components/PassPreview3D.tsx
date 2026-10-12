import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  RotateCw,
  Layers,
  Sparkles,
  Maximize2,
  Sliders,
  Sun,
  Eye,
  Settings,
  HelpCircle,
  RefreshCw,
  Video,
  Camera,
} from 'lucide-react';
import { ARPreviewOverlay } from './ARPreviewOverlay';
import { renderAprilTagDataUrl, AR_APRILTAG_ID } from '../utils/apriltagGen';
import { createAcrylicRefractionMaterial } from '../utils/acrylicRefraction';
import { PassCardInfo, E1Options, LayerVisibilityConfig, DEFAULT_LAYER_VISIBILITY } from '../types';
import {
  renderFrontCard,
  renderBackCard,
  renderWhiteCard,
  getBackInnerBorderTemplate,
  loadImage,
  preloadPsdAssets,
  getDiecutMask,
  FONTS_LOADED_EVENT,
  areFontsLoaded,
  CARD_WIDTH,
  CARD_HEIGHT,
} from '../utils/passRenderer';
import {
  buildDiecutShape,
  createFallbackShape,
  CARD_W3D,
  CARD_H3D,
} from '../utils/diecutShape';

interface PassPreview3DProps {
  info: PassCardInfo;
  e1Opts: E1Options;
  frontPhotoUrl: string;
  cutoutPhotoUrl: string;
  customIconUrl: string;
}

export const PassPreview3D: React.FC<PassPreview3DProps> = ({
  info,
  e1Opts,
  frontPhotoUrl,
  cutoutPhotoUrl,
  customIconUrl,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Modeler Control States
  const [thickness, setThickness] = useState<number>(0.4); // Thickness in cm
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const autoRotateRef = useRef<boolean>(autoRotate);
  autoRotateRef.current = autoRotate; // Instantly assign during render to avoid 1-frame latency
  // const [acrylicTint, setAcrylicTint] = useState<string>('#ffffff'); // Default to clear transparent white
  const [lightIntensity, setLightIntensity] = useState<number>(1.2);
  const [isPreloading, setIsPreloading] = useState<boolean>(true);
  const [isUpdatingTextures, setIsUpdatingTextures] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isRecordingGif, setIsRecordingGif] = useState<boolean>(false);
  const [sceneReady, setSceneReady] = useState<boolean>(false);

  // AprilTag AR 锚点与 AR 摄像头预览
  const [qrSizeCm, setQrSizeCm] = useState<number>(5); // AprilTag 物理边长（cm），AR 识别时作为模型缩放基准
  const [arOpen, setArOpen] = useState<boolean>(false);
  // 模型旋转轴：'normal' 绕 AprilTag 法线（竖着转），'plane' 绕平面内轴（躺着转）
  const [rotateAxis, setRotateAxis] = useState<'normal' | 'plane'>('normal');
  // 躺着转时旋转轴在 AprilTag 平面内的角度（0-360，0 = 沿 e1，90 = 沿 e2）
  const [planeAngle, setPlaneAngle] = useState<number>(0);
  // AR 锚点：固定的 AprilTag（tag36h11 id=0），摄像头识别抗光照/反光
  const [apriltagDataUrl, setApriltagDataUrl] = useState<string>('');
  useEffect(() => {
    try {
      setApriltagDataUrl(renderAprilTagDataUrl());
    } catch (err) {
      console.error('AprilTag 生成失败:', err);
      setApriltagDataUrl('');
    }
  }, []);

  // 刀线形状（含孔洞）——由刀线 mask 提取，用于构建真实扫出体积的亚克力几何体
  const [diecutShape, setDiecutShape] = useState<THREE.Shape | null>(null);
  const [shapeFailed, setShapeFailed] = useState<boolean>(false);

  // Hidden offscreen canvas refs for texture rendering
  const frontCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frontBackingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const middleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const backCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [showFaceDebug, setShowFaceDebug] = useState<boolean>(false);
  const [debugFaceTab, setDebugFaceTab] = useState<'frontOuter' | 'frontInner' | 'backInner' | 'backOuter'>('backInner');
  const debugLayerCanvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});

  const downloadBackInnerBorderTemplate = async () => {
    const canvas = await getBackInnerBorderTemplate();
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = '背面内侧_专用饰边模板.png';
    a.click();
  };

  // Three.js object references for dynamic updates
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);

  // 旋转 GIF 录制相关引用
  const isRecordingGifRef = useRef<boolean>(false);
  const recordGifRef = useRef<(() => Promise<void>) | null>(null);
  const passGroupRef = useRef<THREE.Group | null>(null);
  const acrylicDefaultMatsRef = useRef<THREE.Material[] | null>(null);
  const arOpenRef = useRef<boolean>(arOpen);
  arOpenRef.current = arOpen;

  // Geometry and Mesh references
  const acrylicMeshRef = useRef<THREE.Mesh | null>(null);
  const frontMeshRef = useRef<THREE.Mesh | null>(null);
  const frontBackingMeshRef = useRef<THREE.Mesh | null>(null);
  const middleMeshRef = useRef<THREE.Mesh | null>(null);
  const backMeshRef = useRef<THREE.Mesh | null>(null);

  // Texture references
  const frontTexRef = useRef<THREE.CanvasTexture | null>(null);
  const frontBackingTexRef = useRef<THREE.CanvasTexture | null>(null);
  const middleTexRef = useRef<THREE.CanvasTexture | null>(null);
  const backTexRef = useRef<THREE.CanvasTexture | null>(null);

  // Track loaded asset URLs to avoid redundant draw operations
  const [canvasKey, setCanvasKey] = useState<number>(0);

  // 字体加载完成后重新生成纹理（保证画布文字使用自定义字体）
  const [fontTick, setFontTick] = useState<number>(0);

  // 监听字体加载完成事件 → 立即重建 3D 纹理
  useEffect(() => {
    let isMounted = true;
    const onFontsLoaded = () => {
      if (isMounted) setFontTick((t) => t + 1);
    };
    if (!areFontsLoaded() && document.fonts && document.fonts.status === 'loading') {
      document.fonts.addEventListener('loadingdone', onFontsLoaded);
    }
    window.addEventListener(FONTS_LOADED_EVENT, onFontsLoaded);
    return () => {
      isMounted = false;
      if (document.fonts) document.fonts.removeEventListener('loadingdone', onFontsLoaded);
      window.removeEventListener(FONTS_LOADED_EVENT, onFontsLoaded);
    };
  }, []);

  const toggleFullscreen = async () => {
    const target = containerRef.current;
    if (!target) return;

    try {
      if (!document.fullscreenElement) {
        await target.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (error) {
      console.error('Fullscreen toggle failed:', error);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const downloadApriltag = () => {
    if (!apriltagDataUrl) return;
    const a = document.createElement('a');
    a.href = apriltagDataUrl;
    a.download = `AR锚点_AprilTag_id${AR_APRILTAG_ID}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // 1. Initial preload of PSD assets and fonts
  useEffect(() => {
    let active = true;
    async function initPreload() {
      try {
        await preloadPsdAssets();
        if (active) setIsPreloading(false);
      } catch (err) {
        console.error('Error preloading 3D assets:', err);
        if (active) setIsPreloading(false);
      }
    }
    initPreload();
    return () => {
      active = false;
    };
  }, []);

  // 1.5. Extract diecut contour shape from mask (外轮廓 + 孔洞)
  useEffect(() => {
    if (isPreloading) return;
    let active = true;
    (async () => {
      try {
        const mask = await getDiecutMask();
        if (!active) return;
        const shape = buildDiecutShape(mask);
        if (active) {
          setDiecutShape(shape);
          if (!shape) setShapeFailed(true);
        }
      } catch (err) {
        console.error('Failed to build diecut shape:', err);
        if (active) setShapeFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [isPreloading]);

  // 2. Offscreen Canvas Initializer
  useEffect(() => {
    // Create canvas elements once
    frontCanvasRef.current = document.createElement('canvas');
    frontCanvasRef.current.width = CARD_WIDTH;
    frontCanvasRef.current.height = CARD_HEIGHT;

    frontBackingCanvasRef.current = document.createElement('canvas');
    frontBackingCanvasRef.current.width = CARD_WIDTH;
    frontBackingCanvasRef.current.height = CARD_HEIGHT;

    middleCanvasRef.current = document.createElement('canvas');
    middleCanvasRef.current.width = CARD_WIDTH;
    middleCanvasRef.current.height = CARD_HEIGHT;

    backCanvasRef.current = document.createElement('canvas');
    backCanvasRef.current.width = CARD_WIDTH;
    backCanvasRef.current.height = CARD_HEIGHT;
  }, []);

  // 3. Texture Generator (triggers whenever input info/photos change)
  useEffect(() => {
    if (isPreloading) return;

    let isMounted = true;

    async function generateTextures() {
      if (isMounted) setIsUpdatingTextures(true);

      const frontCanvas = frontCanvasRef.current;
      const frontBackingCanvas = frontBackingCanvasRef.current;
      const middleCanvas = middleCanvasRef.current;
      const backCanvas = backCanvasRef.current;

      if (!frontCanvas || !frontBackingCanvas || !middleCanvas || !backCanvas) return;

      const frontCtx = frontCanvas.getContext('2d');
      const frontBackingCtx = frontBackingCanvas.getContext('2d');
      const middleCtx = middleCanvas.getContext('2d');
      const backCtx = backCanvas.getContext('2d');

      if (!frontCtx || !frontBackingCtx || !middleCtx || !backCtx) return;

      try {
        // Load custom uploads
        const [img1Obj, cutoutObj, customIconObj] = await Promise.all([
          frontPhotoUrl ? loadImage(frontPhotoUrl) : Promise.resolve(null),
          cutoutPhotoUrl ? loadImage(cutoutPhotoUrl) : Promise.resolve(null),
          customIconUrl ? loadImage(customIconUrl) : Promise.resolve(null),
        ]);

        if (!isMounted) return;

        // --- A. Draw Front Print Layer ---
        // Contains border overlay, barcode, names, and texts but NO cutout, NO baseboard, NO faction watermark
        frontCtx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
        await renderFrontCard(
          frontCtx,
          info,
          null, // No image on front surface
          e1Opts,
          null, // No custom icon here
          {
            ...DEFAULT_LAYER_VISIBILITY,
            background: false, // Transparent glass overlay
            characterPhoto: false, // In the middle layer
            baseboard: false, // In the middle layer
            factionWatermark: false, // In the middle layer
          },
          undefined,
          true // Apply diecut for 3D preview
        );

        // --- B. Draw Front White Backing Layer ---
        // For standard UV single-sided white printing: any printed front pixel is backed by opaque white ink.
        // Looking from inside-out, these areas appear solid white.
        frontBackingCtx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
        frontBackingCtx.drawImage(frontCanvas, 0, 0);
        const frontImgData = frontBackingCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
        const frontPixels = frontImgData.data;
        for (let i = 0; i < frontPixels.length; i += 4) {
          // If the pixel has any opacity, force it to opaque white (#ffffff, a=255)
          if (frontPixels[i + 3] > 10) {
            frontPixels[i] = 255;
            frontPixels[i + 1] = 255;
            frontPixels[i + 2] = 255;
            frontPixels[i + 3] = 255;
          } else {
            frontPixels[i + 3] = 0;
          }
        }
        frontBackingCtx.putImageData(frontImgData, 0, 0);

        // --- C. Draw Middle Print Layer ---
        // Contains the character cutout standing, E1 baseboard, and faction icon
        middleCtx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
        await renderFrontCard(
          middleCtx,
          info,
          img1Obj,
          e1Opts,
          customIconObj,
          {
            background: false, // Transparent middle layer
            characterPhoto: true,
            baseboard: true,
            factionWatermark: true,
            barcode: false,
            idAndNameText: false,
            professionFactionText: false,
              borderOverlay: true,
          },
          cutoutObj,
          true, // Apply diecut for 3D preview
          'backInner'
        );

        // --- D. Draw Back Print Layer ---
        // Outer back print, which is double-sided graphic background with character silhouette
        // 背面印刷层必须透明背景：亚克力无印刷处透明，从背面看可透出中间层立绘，
        // 与正面（frontTex background:false）的透明观感保持一致。
        backCtx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
        await renderBackCard(
          backCtx,
          info,
          cutoutObj, // Pass the cutout photo
          e1Opts,
          img1Obj,   // Pass the front photo if cutout is not available
          {
            ...DEFAULT_LAYER_VISIBILITY,
            background: false, // Transparent back print layer (无印刷处透明)
            characterPhoto: true, // Keep character silhouette enabled on back face
          },
          true // Apply diecut for 3D preview
        );

        // Notify Three.js textures that contents changed
        if (frontTexRef.current) frontTexRef.current.needsUpdate = true;
        if (frontBackingTexRef.current) frontBackingTexRef.current.needsUpdate = true;
        if (middleTexRef.current) middleTexRef.current.needsUpdate = true;
        if (backTexRef.current) backTexRef.current.needsUpdate = true;

        if (isMounted) {
          setCanvasKey((prev) => prev + 1);
          setIsUpdatingTextures(false);
        }
      } catch (err) {
        console.error('Failed generating textures in 3D:', err);
        if (isMounted) setIsUpdatingTextures(false);
      }
    }

    generateTextures();

    return () => {
      isMounted = false;
    };
  }, [isPreloading, info, e1Opts, frontPhotoUrl, cutoutPhotoUrl, customIconUrl, fontTick]);

  // Render the selected face as individually inspectable layer snapshots, in
  // the same bottom-to-top order used by the source compositor.
  useEffect(() => {
    if (!canvasKey || !showFaceDebug) return;
    let active = true;
    const layerDefs: Record<string, Array<{ key: keyof LayerVisibilityConfig; label: string }>> = {
      frontOuter: [
        { key: 'background', label: '背景' },
        { key: 'characterPhoto', label: '人物照片' },
        { key: 'baseboard', label: '精一底板' },
        { key: 'factionWatermark', label: '阵营水印' },
        { key: 'borderOverlay', label: '饰边/外框' },
        { key: 'barcode', label: '条码' },
        { key: 'idAndNameText', label: 'ID 与名称' },
        { key: 'professionFactionText', label: '职业/阵营文字' },
      ],
      frontInner: [
        { key: 'characterPhoto', label: '人物白墨' },
        { key: 'baseboard', label: '精一底板白墨' },
        { key: 'borderOverlay', label: '饰边白墨' },
        { key: 'idAndNameText', label: 'ID 与名称白墨' },
        { key: 'professionFactionText', label: '职业/阵营白墨' },
      ],
      backInner: [
        { key: 'borderOverlay', label: '背面内侧专用饰边模板' },
        { key: 'characterPhoto', label: '人物抠图' },
        { key: 'baseboard', label: '精一底板' },
        { key: 'factionWatermark', label: '阵营水印' },
      ],
      backOuter: [
        { key: 'background', label: '背景' },
        { key: 'characterPhoto', label: '人物剪影' },
        { key: 'baseboard', label: '精一底板剪影' },
        { key: 'borderOverlay', label: '饰边/外框' },
        { key: 'barcode', label: '条码' },
        { key: 'professionFactionText', label: '职业/阵营文字' },
      ],
    };

    const only = (key: keyof LayerVisibilityConfig): LayerVisibilityConfig => ({
      background: key === 'background',
      characterPhoto: key === 'characterPhoto',
      baseboard: key === 'baseboard',
      factionWatermark: key === 'factionWatermark',
      barcode: key === 'barcode',
      idAndNameText: key === 'idAndNameText',
      professionFactionText: key === 'professionFactionText',
      borderOverlay: key === 'borderOverlay',
    });

    const renderLayers = async () => {
      const defs = layerDefs[debugFaceTab] || [];
      const [img1Obj, cutoutObj, customIconObj] = await Promise.all([
        frontPhotoUrl ? loadImage(frontPhotoUrl) : Promise.resolve(null),
        cutoutPhotoUrl ? loadImage(cutoutPhotoUrl) : Promise.resolve(null),
        customIconUrl ? loadImage(customIconUrl) : Promise.resolve(null),
      ]);
      for (const def of defs) {
        if (!active) return;
        const canvas = debugLayerCanvasRefs.current[`${debugFaceTab}:${def.key}`];
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) continue;
        canvas.width = CARD_WIDTH;
        canvas.height = CARD_HEIGHT;
        const layers = only(def.key);
        if (debugFaceTab === 'frontOuter') {
          await renderFrontCard(ctx, info, img1Obj, e1Opts, customIconObj, layers, cutoutObj, true);
        } else if (debugFaceTab === 'frontInner') {
          await renderWhiteCard(ctx, info, cutoutObj, e1Opts, img1Obj, customIconObj, layers, true);
        } else if (debugFaceTab === 'backInner') {
          await renderFrontCard(ctx, info, img1Obj, e1Opts, customIconObj, layers, cutoutObj, true, 'backInner');
        } else {
          await renderBackCard(ctx, info, cutoutObj, e1Opts, img1Obj, layers, true);
        }
      }
    };
    renderLayers();
    return () => { active = false; };
  }, [canvasKey, showFaceDebug, debugFaceTab, info, e1Opts, frontPhotoUrl, cutoutPhotoUrl, customIconUrl]);

  // 4. Initialize and Render 3D Canvas Scene
  useEffect(() => {
    if (isPreloading || (!diecutShape && !shapeFailed)) return;

    const container = containerRef.current;
    const width = container.clientWidth || 500;
    const height = container.clientHeight || 550;

    // A. Scene Setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // B. Camera Setup
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0, 16);

    // C. WebGL Renderer
    // preserveDrawingBuffer: 允许录制 GIF 时读取帧缓冲（逐帧 drawImage）
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Multi-pass refraction needs the inner layer, acrylic, and outer layer
    // to accumulate in one frame instead of being auto-cleared each draw.
    renderer.autoClear = false;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Fix color space
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // D. Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 6;
    controls.maxDistance = 30;
    controls.maxPolarAngle = Math.PI / 1.1; // Don't let users go completely under the table
    controlsRef.current = controls;

    // E. Lighting（更亮、更柔和的散射光源）
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    // 半球光：模拟天空+地面的柔和环境光，让卡面受光更均匀
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x8899bb, 0.55);
    scene.add(hemiLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, lightIntensity * 1.2);
    dirLight1.position.set(5, 8, 5);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.width = 1024;
    dirLight1.shadow.mapSize.height = 1024;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xbbe1ff, lightIntensity * 0.7);
    dirLight2.position.set(-8, -4, 4);
    scene.add(dirLight2);

    // Dynamic point light following camera to give polished acrylic specular highlights
    const pointLight = new THREE.PointLight(0xffffff, 1.5, 50);
    scene.add(pointLight);

    // F. Texture Bindings
    const frontCanvas = frontCanvasRef.current || document.createElement('canvas');
    const frontBackingCanvas = frontBackingCanvasRef.current || document.createElement('canvas');
    const middleCanvas = middleCanvasRef.current || document.createElement('canvas');
    const backCanvas = backCanvasRef.current || document.createElement('canvas');

    const frontTex = new THREE.CanvasTexture(frontCanvas);
    frontTex.colorSpace = THREE.SRGBColorSpace;
    frontTexRef.current = frontTex;

    const frontBackingTex = new THREE.CanvasTexture(frontBackingCanvas);
    frontTexRef.current.needsUpdate = true;
    frontBackingTexRef.current = frontBackingTex;

    const middleTex = new THREE.CanvasTexture(middleCanvas);
    middleTex.colorSpace = THREE.SRGBColorSpace;
    middleTexRef.current = middleTex;

    const backTex = new THREE.CanvasTexture(backCanvas);
    backTex.colorSpace = THREE.SRGBColorSpace;
    backTexRef.current = backTex;

    // G. Create Acrylic and Print Layers Group
    const passGroup = new THREE.Group();
    passGroupRef.current = passGroup;
    setSceneReady(true);
    scene.add(passGroup);

    // Dimension scales: 10 * 5 * 0.47 cm.
    // In our 3D space, we map 1cm to 1.0 units.
    // Card Width = 5.0, Card Height = 10.0, Card Depth = thickness
    const w = CARD_W3D;
    const h = CARD_H3D;

    // 刀线形状：外轮廓 + 内部孔洞。亚克力实体 = 该形状沿厚度方向扫出的真实体积。
    // 若 mask 提取失败则退化为完整矩形卡面。
    const shape = diecutShape ?? createFallbackShape();

    // 1. Acrylic Base Mesh
    // 亚克力板 = 刀线保留区域沿厚度方向扫出的柱体（含内部孔洞，无倒角）。
    // 顶面/底面：清透半透明玻璃观感（不模拟折射率，仅半透明叠加透出印刷层）；侧面：磨砂效果。
    const extrudeSettings = {
      steps: 1,
      depth: 1.0,
      bevelEnabled: false,
      bevelThickness: 0,
      bevelSize: 0,
      bevelOffset: 0,
      bevelSegments: 0,
    };

    const acrylicGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    acrylicGeo.center(); // Center geometry around (0,0,0) so front face is at +halfD and back is at -halfD

    // 顶面/底面：真实透明实体。印刷层由深度缓冲和背面剔除决定可见性，
    // 不再通过视角分支手动切换印刷面。
    const capMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#ffffff'),
      roughness: 0.12,
      metalness: 0.0,
      transparent: true,
      opacity: 0.2,
      transmission: 0.35,
      ior: 1.49,
      thickness,
      clearcoat: 0.4,
      clearcoatRoughness: 0.12,
      specularIntensity: 1.0,
      side: THREE.DoubleSide,
      depthWrite: false, // 不写深度，让背后的印刷层透过半透明面可见
    });

    // 程序生成的磨砂噪声纹理（模拟激光切割侧面的磨砂颗粒感）
    const createFrostedBump = () => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const c2d = canvas.getContext('2d')!;
      const img = c2d.createImageData(size, size);
      const d = img.data;
      for (let i = 0; i < size * size; i++) {
        const v = 128 + Math.random() * 64; // 中灰噪声，用于 bump 起伏
        d[i * 4] = v;
        d[i * 4 + 1] = v;
        d[i * 4 + 2] = v;
        d[i * 4 + 3] = 255;
      }
      c2d.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(12, 6);
      tex.needsUpdate = true;
      return tex;
    };
    const frostedBump = createFrostedBump();

    // 侧面：透明磨砂实体，始终由真实挤出几何体渲染。
    const sideMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#ffffff'),
      roughness: 0.62,
      metalness: 0.0,
      transparent: true,
      opacity: 0.46,
      clearcoat: 0.0,
      clearcoatRoughness: 1.0,
      specularIntensity: 0.08,
      bumpMap: frostedBump,
      bumpScale: 0.045,
      side: THREE.FrontSide,
      depthWrite: false, // 透明材质不写深度
    });

    // ExtrudeGeometry 材质组：group 0 = 顶面+底面（水平印刷面，用 capMat），group 1 = 侧面（用 sideMat）
    const acrylicMesh: THREE.Mesh<THREE.ExtrudeGeometry, THREE.Material | THREE.Material[]> =
      new THREE.Mesh(acrylicGeo, [capMat, sideMat, capMat]);
    acrylicMesh.userData.isAcrylicBody = true;
    acrylicMesh.receiveShadow = true;
    acrylicMesh.renderOrder = 3;
    acrylicMesh.scale.set(1, 1, thickness); // Scale along Z for thickness
    passGroup.add(acrylicMesh);
    acrylicMeshRef.current = acrylicMesh;

    const acrylicDefaultMats: THREE.Material[] = [capMat, sideMat, capMat];
    acrylicDefaultMatsRef.current = acrylicDefaultMats;

    const envRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, stencilBuffer: false });
    const backfaceRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, stencilBuffer: false });
    envRT.texture.colorSpace = THREE.SRGBColorSpace;
    backfaceRT.texture.colorSpace = THREE.NoColorSpace;

    const backfaceMaterial = new THREE.ShaderMaterial({
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

    const refractCapMat = createAcrylicRefractionMaterial({
      envMap: envRT.texture,
      backfaceMap: backfaceRT.texture,
      frost: 0,
      refractionStrength: 0.72,
      thickness,
    });
    const refractSideMat = createAcrylicRefractionMaterial({
      envMap: envRT.texture,
      backfaceMap: backfaceRT.texture,
      frost: 0.2,
      transmission: 0.75,
      refractionStrength: 0.32,
      thickness,
    });
    const refractionMats: THREE.Material[] = [refractCapMat, refractSideMat, refractCapMat];
    let printMeshes: THREE.Mesh[] = [];
    let outerPrints: THREE.Mesh[] = [];
    let innerPrints: THREE.Mesh[] = [];

    // Physical render order: inner prints -> acrylic -> outer prints.
    // No camera-angle visibility thresholds are used. Face culling and depth
    // buffering determine which physical surface is visible.
    const renderFrame = () => {
      if (arOpenRef.current) {
        acrylicMesh.material = acrylicDefaultMats;
        acrylicMesh.visible = true;
        printMeshes.forEach((mesh) => (mesh.visible = true));
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(scene, camera);
        return;
      }

      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      const targetWidth = Math.max(1, Math.floor(size.x));
      const targetHeight = Math.max(1, Math.floor(size.y));
      if (envRT.width !== targetWidth || envRT.height !== targetHeight) {
        envRT.setSize(targetWidth, targetHeight);
        backfaceRT.setSize(targetWidth, targetHeight);
      }
      refractCapMat.uniforms.resolution.value.copy(size);
      refractSideMat.uniforms.resolution.value.copy(size);
      refractCapMat.uniforms.slabThickness.value = thickness;
      refractSideMat.uniforms.slabThickness.value = thickness;

      // Pass A: inner prints are the captured scene behind the acrylic.
      acrylicMesh.visible = false;
      outerPrints.forEach((mesh) => (mesh.visible = false));
      innerPrints.forEach((mesh) => (mesh.visible = true));
      renderer.setRenderTarget(envRT);
      renderer.clear();
      renderer.render(scene, camera);

      // Pass B: capture the back-facing normal of the acrylic slab.
      innerPrints.forEach((mesh) => (mesh.visible = false));
      acrylicMesh.visible = true;
      acrylicMesh.material = backfaceMaterial;
      renderer.setRenderTarget(backfaceRT);
      renderer.clear();
      renderer.render(scene, camera);

      // Pass C: draw inner prints, refractive acrylic, then sharp outer prints.
      acrylicMesh.visible = false;
      innerPrints.forEach((mesh) => (mesh.visible = true));
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(scene, camera);

      acrylicMesh.visible = true;
      acrylicMesh.material = refractionMats;
      renderer.render(scene, camera);

      acrylicMesh.visible = false;
      innerPrints.forEach((mesh) => (mesh.visible = false));
      outerPrints.forEach((mesh) => (mesh.visible = true));
      renderer.render(scene, camera);

      acrylicMesh.material = acrylicDefaultMats;
      acrylicMesh.visible = true;
      printMeshes.forEach((mesh) => (mesh.visible = true));
    };

    // Helper to assign correct [0, 1] texture coordinates based on X/Y card dimensions
    const assignUVs = (geometry: THREE.BufferGeometry, width: number, height: number, flipU: boolean = false) => {
      const posAttr = geometry.attributes.position;
      if (!posAttr) return;
      const count = posAttr.count;
      const uvs = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        const x = posAttr.getX(i);
        const y = posAttr.getY(i);
        // Map x from [-width/2, width/2] to [0, 1]
        let u = (x + width / 2) / width;
        if (flipU) {
          u = 1.0 - u;
        }
        // Map y from [-height/2, height/2] to [0, 1]
        const v = (y + height / 2) / height;
        uvs[i * 2] = u;
        uvs[i * 2 + 1] = v;
      }
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    };

    // 2. Printed Layers Setup
    // 印刷层使用与亚克力相同的刀线 Shape（含孔洞），保证所有印刷面按刀线轮廓裁剪
    const planeGeo = new THREE.ShapeGeometry(shape);
    assignUVs(planeGeo, w, h, false);

    // Create a separate geometry for the back print with flipped U coordinate so the text displays readable (non-mirrored) on the back face
    const backPlaneGeo = new THREE.ShapeGeometry(shape);
    assignUVs(backPlaneGeo, w, h, true);

    // A. Front Print (正面最外层) - faces front
    // 印刷层使用不透明渲染（transparent:false）+ alphaTest 丢弃挖空区域，
    // 不模拟折射，直接以"直见"方式贴在卡表面，透过半透明亚克力面可见。
    const frontMat = new THREE.MeshBasicMaterial({
      map: frontTex,
      transparent: false,
      alphaTest: 0.1,
      side: THREE.FrontSide, // Only visible from front
      depthWrite: true, // Write depth to handle spatial occlusion automatically
    });
    const frontMesh = new THREE.Mesh(planeGeo, frontMat);
    frontMesh.userData.printLayer = 'frontOuter';
    frontMesh.renderOrder = 5;
    passGroup.add(frontMesh);
    frontMeshRef.current = frontMesh;

    // B. Front White Backing (正面白墨底) - faces back (looking from inside out) - horizontally mirrored
    const frontBackingMat = new THREE.MeshBasicMaterial({
      map: frontBackingTex,
      transparent: false,
      alphaTest: 0.1,
      side: THREE.BackSide, // Only visible from inside/back
      depthWrite: true,
    });
    const frontBackingMesh = new THREE.Mesh(planeGeo, frontBackingMat);
    frontBackingMesh.userData.printLayer = 'frontInner';
    frontBackingMesh.renderOrder = 4;
    passGroup.add(frontBackingMesh);
    frontBackingMeshRef.current = frontBackingMesh;

    // C. Back inner print. This layer is printed on the inner back surface
    // but faces forward, so it is naturally visible through the acrylic from
    // the front and is culled from the back by the single-sided material.
    const middleMat = new THREE.MeshBasicMaterial({
      map: middleTex,
      transparent: false,
      alphaTest: 0.1,
      side: THREE.FrontSide,
      depthWrite: true,
    });
    const middleMesh = new THREE.Mesh(planeGeo, middleMat);
    middleMesh.userData.printLayer = 'backInner';
    middleMesh.renderOrder = 2;
    passGroup.add(middleMesh);
    middleMeshRef.current = middleMesh;

    // D. Back Print (背面最外层：商标、背景、条码等) - faces back with flipped U coordinates so back text reads normally
    const backMat = new THREE.MeshBasicMaterial({
      map: backTex,
      transparent: false,
      alphaTest: 0.1,
      side: THREE.BackSide, // Only visible from back
      depthWrite: true,
    });
    const backMesh = new THREE.Mesh(backPlaneGeo, backMat);
    backMesh.userData.printLayer = 'backOuter';
    backMesh.renderOrder = 1;
    passGroup.add(backMesh);
    backMeshRef.current = backMesh;

    printMeshes = [frontMesh, frontBackingMesh, middleMesh, backMesh];
    outerPrints = [frontMesh, backMesh];
    innerPrints = [frontBackingMesh, middleMesh];

    // Setup positions based on thickness (depth/2)
    // 印刷层相对亚克力表面向外偏移 0.001 单位（=0.01mm，1 单位=1cm）：
    // 让印刷层清晰覆盖在亚克力折射面上，避免与表面共面导致渲染计算混乱。
    const updatePositions = () => {
      const halfD = thickness / 2;

      if (acrylicMeshRef.current) {
        acrylicMeshRef.current.position.set(0, 0, 0);
        acrylicMeshRef.current.scale.set(1, 1, thickness);
      }
      if (frontMeshRef.current) {
        frontMeshRef.current.position.set(0, 0, halfD + 0.001);
      }
      if (frontBackingMeshRef.current) {
        frontBackingMeshRef.current.position.set(0, 0, halfD - 0.002);
      }
      if (middleMeshRef.current) {
        middleMeshRef.current.position.set(0, 0, -halfD + 0.002);
      }
      if (backMeshRef.current) {
        backMeshRef.current.position.set(0, 0, -halfD - 0.001);
      }
    };

    updatePositions();

    // H. Add a subtle base grid and lighting shadow catcher
    const shadowGeo = new THREE.PlaneGeometry(12, 12);
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.15 });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = -6;
    shadowMesh.receiveShadow = true;
    scene.add(shadowMesh);

    // 录制旋转 GIF：手动将通行证绕 Y 轴旋转 360°，逐帧渲染并编码为 GIF 下载
    const recordGif = async () => {
      if (isRecordingGifRef.current) return;
      isRecordingGifRef.current = true;
      setIsRecordingGif(true);

      const wasAutoRotate = autoRotateRef.current;
      autoRotateRef.current = false; // 暂停自动旋转，避免叠加
      if (controls) controls.enabled = false; // 录制期间锁定视角

      const startAngle = passGroup.rotation.y;
      const frames = 240; // 240 帧绕一圈（16 秒，15fps）
      const delayMs = 1000 / 15;
      const targetW = 360 * 4; // 16 倍像素：宽高各 ×4，面积 ×16（1440 宽）
      const cssW = renderer.domElement.clientWidth || 500;
      const cssH = renderer.domElement.clientHeight || 550;
      const targetH = Math.max(1, Math.round((cssH / cssW) * targetW));

      try {
        // 让"录制中"状态先渲染出来
        await new Promise((r) => setTimeout(r, 30));
        const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
        const gif = GIFEncoder();
        const off = document.createElement('canvas');
        off.width = targetW;
        off.height = targetH;
        const offCtx = off.getContext('2d', { willReadFrequently: true });
        if (!offCtx) throw new Error('无法创建离屏画布');

        for (let i = 0; i < frames; i++) {
          passGroup.rotation.y = startAngle + (i / frames) * Math.PI * 2;
          renderFrame();
          offCtx.clearRect(0, 0, targetW, targetH);
          offCtx.drawImage(renderer.domElement, 0, 0, targetW, targetH);
          const { data } = offCtx.getImageData(0, 0, targetW, targetH);
          const palette = quantize(data, 256);
          const index = applyPalette(data, palette);
          gif.writeFrame(index, targetW, targetH, { palette, delay: delayMs, repeat: 0 });
        }
        gif.finish();
        const blob = new Blob([gif.bytes()], { type: 'image/gif' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `PassCard_Generator_旋转预览_${info.english_name || info.chinese_name || 'card'}.gif`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (err) {
        console.error('录制 GIF 失败:', err);
      } finally {
        passGroup.rotation.y = startAngle;
        autoRotateRef.current = wasAutoRotate;
        if (controls) controls.enabled = true;
        isRecordingGifRef.current = false;
        setIsRecordingGif(false);
      }
    };
    recordGifRef.current = recordGif;

    // Render loop
    const animate = () => {
      animationFrameIdRef.current = requestAnimationFrame(animate);

      // Light coordinates track camera
      pointLight.position.copy(camera.position);

      if (autoRotateRef.current && passGroup) {
        passGroup.rotation.y += 0.006;
      }

      controls.update();
      renderFrame();
    };

    animate();

    // I. Handle Resize
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Save references to allow dynamically changing values on state update
    const cameraRef = { current: camera };

    // Cleanups
    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
      if (controlsRef.current) controlsRef.current.dispose();
      if (rendererRef.current) {
        rendererRef.current.dispose();
        if (container.contains(rendererRef.current.domElement)) {
          container.removeChild(rendererRef.current.domElement);
        }
      }

      // Dispose Geometries and Materials
      acrylicGeo.dispose();
      planeGeo.dispose();
      backPlaneGeo.dispose();
      capMat.dispose();
      sideMat.dispose();
      frontMat.dispose();
      frontBackingMat.dispose();
      middleMat.dispose();
      backMat.dispose();
      shadowGeo.dispose();
      shadowMat.dispose();

      // Dispose textures
      frontTex.dispose();
      frontBackingTex.dispose();
      middleTex.dispose();
      backTex.dispose();
      frostedBump.dispose();
      envRT.dispose();
      backfaceRT.dispose();
      backfaceMaterial.dispose();
      refractCapMat.dispose();
      refractSideMat.dispose();
      acrylicDefaultMatsRef.current = null;

      passGroupRef.current = null;
      setSceneReady(false);
      recordGifRef.current = null;
    };
  }, [isPreloading, diecutShape, shapeFailed]);

  // 5. Dynamic prop updates (Thickness, Tint) without fully rebuilding Scene
  useEffect(() => {
    if (isPreloading) return;

    // Update positions
    const halfD = thickness / 2;

    if (frontMeshRef.current) {
      frontMeshRef.current.position.set(0, 0, halfD + 0.001);
    }
    if (frontBackingMeshRef.current) {
      frontBackingMeshRef.current.position.set(0, 0, halfD - 0.002);
    }
    if (middleMeshRef.current) {
      middleMeshRef.current.position.set(0, 0, -halfD + 0.002);
    }
    if (backMeshRef.current) {
      backMeshRef.current.position.set(0, 0, -halfD - 0.001);
    }

    // Update Acrylic Core geometry and scale when thickness changes
    if (acrylicMeshRef.current) {
      acrylicMeshRef.current.scale.set(1, 1, thickness);
    }
  }, [thickness, canvasKey]);

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-none overflow-y-auto text-xs">
      {/* 3D View Container & Canvas Overlay Controls */}
      <div className="relative flex-none h-[520px] min-h-[520px] rounded-xl border border-slate-800/80 overflow-hidden bg-radial from-slate-900 to-slate-950 flex items-center justify-center border-b border-slate-800">
        {isPreloading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-md text-blue-400 gap-3">
            <RefreshCw className="w-6 h-6 animate-spin" />
            <span className="font-medium">初始化 3D 物理引擎与预载图层...</span>
          </div>
        )}

        {isUpdatingTextures && !isPreloading && (
          <div className="absolute top-4 left-4 z-10 px-3 py-1.5 rounded-lg bg-slate-950/80 border border-blue-500/30 text-blue-400 flex items-center gap-2 text-[11px] shadow-lg backdrop-blur-xs">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>卡面纹理同步更新中...</span>
          </div>
        )}

        {/* Dynamic Canvas Container for ThreeJS Renderer */}
        <div ref={containerRef} className="w-full h-full absolute inset-0 cursor-grab active:cursor-grabbing" />

        {/* 3D Action floating panel overlay */}
        <div className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 bg-slate-950/80 p-1.5 rounded-xl border border-slate-800 shadow-xl backdrop-blur-md">
          <button
            onClick={() => setAutoRotate((prev) => !prev)}
            className={`p-2 rounded-lg transition flex items-center gap-1.5 ${
              autoRotate
                ? 'bg-blue-600 text-white shadow'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title={autoRotate ? '停止自动旋转' : '开启自动旋转'}
          >
            <RotateCw className={`w-4 h-4 ${autoRotate ? 'animate-spin [animation-duration:8s]' : ''}`} />
            <span className="text-[10px] font-bold px-0.5">{autoRotate ? '自动旋转中' : '已暂停旋转'}</span>
          </button>
          <button
            onClick={() => recordGifRef.current?.()}
            disabled={isRecordingGif}
            className={`p-2 rounded-lg transition flex items-center gap-1.5 ${
              isRecordingGif
                ? 'bg-amber-600 text-white cursor-wait'
                : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700'
            }`}
            title="录制通行证旋转 GIF（绕一圈 16 秒）"
          >
            <Video className="w-4 h-4" />
            <span className="text-[10px] font-bold px-0.5">{isRecordingGif ? '录制中...' : '录制 GIF'}</span>
          </button>
          <button
            onClick={() => {
              if (controlsRef.current) {
                controlsRef.current.reset();
                if (sceneRef.current) sceneRef.current.rotation.set(0, 0, 0);
              }
            }}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
            title="重置视角"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition"
            title={isFullscreen ? '退出全屏' : '全屏预览'}
            aria-label={isFullscreen ? '退出全屏' : '全屏预览'}
          >
            {isFullscreen ? <Maximize2 className="w-4 h-4 rotate-180" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setArOpen(true)}
            disabled={!sceneReady}
            className={`p-2 rounded-lg transition ${
              sceneReady
                ? 'text-slate-300 hover:text-white hover:bg-slate-800'
                : 'text-slate-600 cursor-not-allowed'
            }`}
            title={sceneReady ? '开启摄像头（扫描二维码后模型将叠加到二维码上方）' : '模型初始化中，请稍候'}
            aria-label="开启摄像头"
          >
            <Camera className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Instructions Overlay */}
        <div className="absolute top-4 right-4 text-[11px] bg-slate-950/60 text-slate-400 px-3 py-1.5 rounded-lg border border-slate-800/80 pointer-events-none select-none">
          💡 拖拽进行 3D 旋转 · 滚轮进行缩放
        </div>
      </div>

      {/* 3D Physical Material Controls */}
      <div className="p-4 bg-slate-950/80 border-t border-slate-900 space-y-4">
        {/* Row 1: Grid controls */}
        <div className="grid grid-cols-2 gap-4">
          {/* Acrylic physical thickness */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5 text-slate-300 font-semibold">
                <Sliders className="w-3.5 h-3.5 text-blue-400" />
                亚克力板材厚度 (cm)
              </span>
              <span className="font-mono text-blue-400 font-bold">{thickness} cm</span>
            </div>
            <input
              type="range"
              min="0.2"
              max="1.2"
              step="0.05"
              value={thickness}
              onChange={(e) => setThickness(parseFloat(e.target.value))}
              className="w-full accent-blue-500 bg-slate-800 h-1 rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>

        {/* Row 2: Rotation & Light quick switches */}
        <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800 p-3 rounded-xl gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
              <RotateCw className={`w-4 h-4 ${autoRotate ? 'animate-spin [animation-duration:12s]' : ''}`} />
            </div>
            <div>
              <div className="font-bold text-slate-200">自动旋转展示</div>
              <div className="text-[10px] text-slate-500">开启后亚克力牌将水平匀速旋转</div>
            </div>
          </div>
          <button
            onClick={() => setAutoRotate((prev) => !prev)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer select-none ${
              autoRotate
                ? 'bg-red-600/25 hover:bg-red-600/35 text-red-300 border border-red-500/30'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-900/25'
            }`}
          >
            {autoRotate ? '暂停旋转' : '开始旋转'}
          </button>
        </div>

        {/* Row 3: AR 锚点（固定 AprilTag）——摄像头识别它来定位模型，比二维码抗光照/反光 */}
        <div className="bg-slate-900/60 border border-slate-800 p-3 rounded-xl">
          <div className="flex items-start gap-3">
            <div className="shrink-0 bg-white p-1.5 rounded-lg shadow-inner">
              {apriltagDataUrl ? (
                <img src={apriltagDataUrl} alt="AprilTag AR 锚点" className="w-24 h-24" />
              ) : (
                <div className="w-24 h-24 flex items-center justify-center text-slate-300">
                  <Camera className="w-8 h-8" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
                  <Camera className="w-4 h-4 text-teal-400" />
                  <span>AR 锚点（AprilTag id={AR_APRILTAG_ID}）</span>
                </div>
                <button
                  onClick={downloadApriltag}
                  disabled={!apriltagDataUrl}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white shadow-md shadow-teal-900/25 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  title="下载 AprilTag 锚点图，打印/显示后供 AR 摄像头识别"
                >
                  下载 AR 锚点 PNG
                </button>
              </div>
              <div className="text-[10px] text-slate-500 leading-relaxed">
                下载并打印锚点，摄像头识别后模型将叠加于其上。
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className="shrink-0">打印尺寸</span>
                <input
                  type="range"
                  min="3"
                  max="15"
                  step="0.5"
                  value={qrSizeCm}
                  onChange={(e) => setQrSizeCm(parseFloat(e.target.value))}
                  className="flex-1 accent-teal-500 h-1"
                />
                <span className="font-mono text-teal-400 font-bold w-12 text-right">{qrSizeCm} cm</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className="shrink-0">旋转轴</span>
                <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-xs">
                  {(
                    [
                      { id: 'normal', label: '竖着转（绕法线）' },
                      { id: 'plane', label: '躺着转（绕平面内）' },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.id}
                      onClick={() => setRotateAxis(o.id)}
                      className={`px-2.5 py-1 rounded-md font-medium transition ${
                        rotateAxis === o.id
                          ? 'bg-teal-600 text-white shadow'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              {rotateAxis === 'plane' && (
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="shrink-0">轴角度</span>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    step="1"
                    value={planeAngle}
                    onChange={(e) => setPlaneAngle(parseFloat(e.target.value))}
                    className="flex-1 accent-teal-500 h-1"
                  />
                  <input
                    type="number"
                    min="0"
                    max="360"
                    step="1"
                    value={planeAngle}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setPlaneAngle(Number.isFinite(v) ? Math.min(360, Math.max(0, v)) : 0);
                    }}
                    className="w-16 px-1 py-0.5 rounded bg-slate-900 border border-slate-700 text-teal-300 font-mono text-right"
                  />
                  <span className="text-slate-500">°</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-amber-300">四个印刷面调试</div>
              <div className="mt-1 text-[10px] text-slate-400">查看正面外侧、正面内侧、背面内侧、背面外侧的原始合成内容</div>
            </div>
            <button
              onClick={() => setShowFaceDebug((prev) => !prev)}
              className="shrink-0 rounded-lg border border-amber-500/60 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20"
            >
              {showFaceDebug ? '隐藏调试面板' : '打开四面调试'}
            </button>
          </div>
        </div>

        </div>

      {/* 四个印刷面调试：先选面，再按叠加顺序查看单层 */}
      <div className="px-4 py-3 bg-slate-950/80 border-t border-slate-900">
        {showFaceDebug && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
              {([
                ['frontOuter', '正面外侧'],
                ['frontInner', '正面内侧'],
                ['backInner', '背面内侧'],
                ['backOuter', '背面外侧'],
              ] as const).map(([key, label]) => (
                <button key={key} onClick={() => setDebugFaceTab(key)} className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${debugFaceTab === key ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-100'}`}>
                  {label}
                </button>
              ))}
              <button
                onClick={downloadBackInnerBorderTemplate}
                className="ml-auto px-3 py-1.5 rounded-md text-xs font-semibold text-teal-300 hover:bg-teal-500/15"
                title="保存背面内侧专用饰边模板"
              >
                保存内侧边框模板
              </button>
            </div>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {(debugFaceTab === 'frontOuter' ? [
              ['background', '背景'], ['characterPhoto', '人物照片'], ['baseboard', '精一底板'], ['factionWatermark', '阵营水印'], ['borderOverlay', '饰边/外框'], ['barcode', '条码'], ['idAndNameText', 'ID 与名称'], ['professionFactionText', '职业/阵营文字'],
            ] : debugFaceTab === 'frontInner' ? [
              ['characterPhoto', '人物白墨'], ['baseboard', '精一底板白墨'], ['borderOverlay', '饰边白墨'], ['idAndNameText', 'ID 与名称白墨'], ['professionFactionText', '职业/阵营白墨'],
            ] : debugFaceTab === 'backInner' ? [
              ['borderOverlay', '专用饰边模板'], ['characterPhoto', '人物抠图'], ['baseboard', '精一底板'], ['factionWatermark', '阵营水印'],
            ] : [
              ['background', '背景'], ['characterPhoto', '人物剪影'], ['baseboard', '精一底板剪影'], ['borderOverlay', '饰边/外框'], ['barcode', '条码'], ['professionFactionText', '职业/阵营文字'],
            ]).map(([layerKey, label], index) => {
              const canvasKey = `${debugFaceTab}:${layerKey}`;
              return (
                <div key={canvasKey} className="min-w-0 rounded-lg border border-amber-500/30 bg-slate-900 p-2">
                <div className="mb-2 text-[11px] font-bold text-amber-300">{index + 1}. {label}</div>
                <div className="rounded border border-slate-700 bg-[linear-gradient(45deg,#1e293b_25%,transparent_25%),linear-gradient(-45deg,#1e293b_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#1e293b_75%),linear-gradient(-45deg,transparent_75%,#1e293b_75%)] bg-[length:12px_12px] bg-[position:0_0,0_6px,6px_-6px,-6px_0] overflow-hidden">
                  <canvas
                    ref={(node) => { debugLayerCanvasRefs.current[canvasKey] = node; }}
                    width={CARD_WIDTH}
                    height={CARD_HEIGHT}
                    className="block w-full h-auto"
                  />
                </div>
                </div>
              );
            })}
            </div>
          </div>
        )}
      </div>

      {/* AR 摄像头全屏预览：扫描 AprilTag 锚点后把模型叠加到锚点上方 */}
      {arOpen && (
        <ARPreviewOverlay
          passGroup={passGroupRef.current}
          qrSizeCm={qrSizeCm}
          thickness={thickness}
          autoRotate={autoRotate}
          rotateAxis={rotateAxis}
          planeAngle={planeAngle}
          onClose={() => setArOpen(false)}
        />
      )}
    </div>
  );
};
