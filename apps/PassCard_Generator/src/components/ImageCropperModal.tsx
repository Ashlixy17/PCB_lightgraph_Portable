import React, { useState, useRef, useEffect } from 'react';
import { X, ZoomIn, ZoomOut, Check, Move, Eye, EyeOff, Maximize2, RefreshCw, ArrowRight, ArrowLeft, Crop } from 'lucide-react';

interface ImageCropperModalProps {
  isOpen: boolean;
  onClose: () => void;
  frontPhotoUrl: string;
  cutoutPhotoUrl: string;
  onApplyCropped: (croppedFront: string, croppedCutout: string) => void;
}

// ---- 裁剪配置记忆（按图片 URL 组合哈希存储到 localStorage）----
interface CropState {
  cutoutPos: { x: number; y: number };
  cutoutScale: number;
  cropBoxScale: number;
  cropBoxPos: { x: number; y: number };
  cropBoxRotation: number;
}

const CROP_STATE_PREFIX = 'PASS_CROP_STATE_V1_';

// djb2 字符串哈希，用于为图片 URL 组合生成稳定且简短的存储 key
function hashString(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

function getCropStateKey(frontPhotoUrl: string, cutoutPhotoUrl: string): string {
  return CROP_STATE_PREFIX + hashString(frontPhotoUrl + '||' + cutoutPhotoUrl);
}

function loadCropState(frontPhotoUrl: string, cutoutPhotoUrl: string): CropState | null {
  try {
    if (!frontPhotoUrl && !cutoutPhotoUrl) return null;
    const raw = localStorage.getItem(getCropStateKey(frontPhotoUrl, cutoutPhotoUrl));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CropState;
    // 简单校验字段完整性
    if (typeof parsed?.cutoutScale !== 'number' || typeof parsed?.cropBoxScale !== 'number') return null;
    return parsed;
  } catch (err) {
    console.warn('读取裁剪记忆失败:', err);
    return null;
  }
}

function saveCropState(frontPhotoUrl: string, cutoutPhotoUrl: string, state: CropState) {
  try {
    if (!frontPhotoUrl && !cutoutPhotoUrl) return;
    localStorage.setItem(getCropStateKey(frontPhotoUrl, cutoutPhotoUrl), JSON.stringify(state));
  } catch (err) {
    console.warn('保存裁剪记忆失败:', err);
  }
}

export const ImageCropperModal: React.FC<ImageCropperModalProps> = ({
  isOpen,
  onClose,
  frontPhotoUrl,
  cutoutPhotoUrl,
  onApplyCropped,
}) => {
  // Step state: 'align' (Step 1) | 'crop' (Step 2)
  const [step, setStep] = useState<'align' | 'crop'>('align');

  // Step 1: Cutout alignment offsets & scale relative to base photo
  const [cutoutPos, setCutoutPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [cutoutScale, setCutoutScale] = useState<number>(1.0);

  // Blinking effect state for Step 1
  const [isBlinking, setIsBlinking] = useState<boolean>(true);
  const [blinkVisible, setBlinkVisible] = useState<boolean>(true);

  // Step 2: Selection crop box (590 : 1180 aspect ratio frame - 1:2 ratio)
  const [cropBoxScale, setCropBoxScale] = useState<number>(1.0);
  const [cropBoxPos, setCropBoxPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  // 裁切框旋转角度（弧度，canvas 坐标系下顺时针为正）
  const [cropBoxRotation, setCropBoxRotation] = useState<number>(0);

  // Interaction mode: 'cutout' | 'cropbox' | 'resize' | 'rotate'
  const [dragTarget, setDragTarget] = useState<'cutout' | 'cropbox' | 'resize' | 'rotate' | null>(null);
  // 拖动角点时记录角点所在象限（局部坐标符号）
  const [dragCorner, setDragCorner] = useState<{ sx: number; sy: number } | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  // 悬停时鼠标样式：'move' | 'resize' | 'rotate' | null
  const [hoverMode, setHoverMode] = useState<'move' | 'resize' | 'rotate' | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frontImgRef = useRef<HTMLImageElement | null>(null);
  const cutoutImgRef = useRef<HTMLImageElement | null>(null);

  // Helper to get base bounding box for rendering so it fits in canvas
  const getBaseRect = (imgWidth: number, imgHeight: number, cWidth: number, cHeight: number) => {
    const maxWidth = cWidth * 0.9;
    const maxHeight = cHeight * 0.9;
    const scale = Math.min(maxWidth / imgWidth, maxHeight / imgHeight);
    const w = imgWidth * scale;
    const h = imgHeight * scale;
    const x = (cWidth - w) / 2;
    const y = (cHeight - h) / 2;
    return { x, y, w, h, scale };
  };

  // Helper to get crop box rect based on scale and position
  // 返回中心 + 未旋转时的宽高（保持 1:2 比例）+ 旋转角度
  const getCropBoxRect = (cWidth: number, cHeight: number) => {
    const baseW = 250;
    const baseH = 500;
    const w = baseW * cropBoxScale;
    const h = baseH * cropBoxScale;
    const cx = cWidth / 2 + cropBoxPos.x;
    const cy = cHeight / 2 + cropBoxPos.y;
    const x = cx - w / 2;
    const y = cy - h / 2;
    return { x, y, w, h, cx, cy, rotation: cropBoxRotation };
  };

  // 画布坐标 → 裁切框局部坐标（局部 x 沿框宽方向，局部 y 沿框高方向）
  const toLocal = (cropBox: ReturnType<typeof getCropBoxRect>, px: number, py: number) => {
    const dx = px - cropBox.cx;
    const dy = py - cropBox.cy;
    const cos = Math.cos(cropBox.rotation);
    const sin = Math.sin(cropBox.rotation);
    return {
      lx: dx * cos + dy * sin,
      ly: -dx * sin + dy * cos,
    };
  };

  // 局部坐标 → 画布坐标
  const toCanvas = (cropBox: ReturnType<typeof getCropBoxRect>, lx: number, ly: number) => {
    const cos = Math.cos(cropBox.rotation);
    const sin = Math.sin(cropBox.rotation);
    return {
      x: cropBox.cx + lx * cos - ly * sin,
      y: cropBox.cy + lx * sin + ly * cos,
    };
  };

  // 旋转框四个角点的画布坐标（局部 ±halfW / ±halfH）
  // 按环绕顺序：右上 → 右下 → 左下 → 左上，保证 Path2D 连线不交叉
  const getRotatedCorners = (cropBox: ReturnType<typeof getCropBoxRect>) => {
    const halfW = cropBox.w / 2;
    const halfH = cropBox.h / 2;
    const corners: { x: number; y: number }[] = [];
    for (const [sx, sy] of [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ]) {
      corners.push(toCanvas(cropBox, sx * halfW, sy * halfH));
    }
    return corners;
  };

  // 旋转框 Path2D（用于裁剪 / 暗化外部）
  const buildRotatedPath = (cropBox: ReturnType<typeof getCropBoxRect>) => {
    const path = new Path2D();
    const corners = getRotatedCorners(cropBox);
    path.moveTo(corners[0].x, corners[0].y);
    path.lineTo(corners[1].x, corners[1].y);
    path.lineTo(corners[2].x, corners[2].y);
    path.lineTo(corners[3].x, corners[3].y);
    path.closePath();
    return path;
  };

  // Load images when opened & reset step (恢复该图片上次的对齐/裁切记忆)
  useEffect(() => {
    if (!isOpen) return;
    setStep('align');
    setIsBlinking(true);

    const saved = loadCropState(frontPhotoUrl, cutoutPhotoUrl);
    if (saved) {
      setCutoutPos(saved.cutoutPos);
      setCutoutScale(saved.cutoutScale);
      setCropBoxScale(saved.cropBoxScale);
      setCropBoxPos(saved.cropBoxPos);
      setCropBoxRotation(saved.cropBoxRotation);
    } else {
      setCutoutPos({ x: 0, y: 0 });
      setCutoutScale(1.0);
      setCropBoxScale(1.0);
      setCropBoxPos({ x: 0, y: 0 });
      setCropBoxRotation(0);
    }

    if (frontPhotoUrl) {
      const img = new Image();
      img.src = frontPhotoUrl;
      img.onload = () => {
        frontImgRef.current = img;
      };
    } else {
      frontImgRef.current = null;
    }

    if (cutoutPhotoUrl) {
      const cImg = new Image();
      cImg.src = cutoutPhotoUrl;
      cImg.onload = () => {
        cutoutImgRef.current = cImg;
      };
    } else {
      cutoutImgRef.current = null;
    }
  }, [isOpen, frontPhotoUrl, cutoutPhotoUrl]);

  // 打开期间自动保存裁剪配置，保证重新进入同一图片时恢复上次状态
  useEffect(() => {
    if (!isOpen) return;
    saveCropState(frontPhotoUrl, cutoutPhotoUrl, {
      cutoutPos,
      cutoutScale,
      cropBoxScale,
      cropBoxPos,
      cropBoxRotation,
    });
  }, [isOpen, frontPhotoUrl, cutoutPhotoUrl, cutoutPos, cutoutScale, cropBoxScale, cropBoxPos, cropBoxRotation]);

  // Blinking Timer (500ms toggle in Step 1)
  useEffect(() => {
    if (!isOpen || step !== 'align' || !isBlinking) {
      setBlinkVisible(true);
      return;
    }
    const timer = setInterval(() => {
      setBlinkVisible((prev) => !prev);
    }, 500);
    return () => clearInterval(timer);
  }, [isOpen, step, isBlinking]);

  // Render Canvas
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dark canvas background grid
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid lines for precise alignment
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // 0. Checkerboard grid inside crop box to visualize transparent overflow areas
    const cropBox = getCropBoxRect(canvas.width, canvas.height);
    ctx.save();
    ctx.clip(buildRotatedPath(cropBox));

    const tileSize = 12;
    for (let cx = cropBox.x - 24; cx < cropBox.x + cropBox.w + 24; cx += tileSize) {
      for (let cy = cropBox.y - 24; cy < cropBox.y + cropBox.h + 24; cy += tileSize) {
        const isEven = (Math.floor((cx - cropBox.x) / tileSize) + Math.floor((cy - cropBox.y) / tileSize)) % 2 === 0;
        ctx.fillStyle = isEven ? '#1e293b' : '#0f172a';
        ctx.fillRect(cx, cy, tileSize, tileSize);
      }
    }
    ctx.restore();

    // 1. Render Base Photo ("原图")
    if (frontImgRef.current) {
      const img = frontImgRef.current;
      ctx.save();
      const { x: dx, y: dy, w: drawW, h: drawH } = getBaseRect(img.width, img.height, canvas.width, canvas.height);
      ctx.drawImage(img, dx, dy, drawW, drawH);
      ctx.restore();
    }

    // 2. Render Cutout Photo ("抠图") with Blinking & Alignment Offset
    if (cutoutImgRef.current) {
      const cImg = cutoutImgRef.current;
      ctx.save();
      const { w: baseW, h: baseH } = getBaseRect(cImg.width, cImg.height, canvas.width, canvas.height);
      const dx = (canvas.width - baseW) / 2 + cutoutPos.x;
      const dy = (canvas.height - baseH) / 2 + cutoutPos.y;

      const finalW = baseW * cutoutScale;
      const finalH = baseH * cutoutScale;
      const finalX = dx + (baseW - finalW) / 2;
      const finalY = dy + (baseH - finalH) / 2;

      // Opacity during blinking (only in Step 1)
      ctx.globalAlpha = step === 'align' && blinkVisible ? 1.0 : step === 'crop' ? 1.0 : 0.2;
      ctx.drawImage(cImg, finalX, finalY, finalW, finalH);
      ctx.restore();
    }

    // 3. Render Aspect Ratio Selection Crop Frame (590:1180 Frame)
    ctx.save();
    if (step === 'crop') {
      // Darken outside crop frame in Step 2 (evenodd: 全屏暗色矩形挖去旋转框)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      const outsidePath = new Path2D();
      outsidePath.rect(0, 0, canvas.width, canvas.height);
      outsidePath.addPath(buildRotatedPath(cropBox));
      ctx.fill(outsidePath, 'evenodd');

      // 旋转框虚线边框
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke(buildRotatedPath(cropBox));
      ctx.setLineDash([]);

      // 四个角点手柄（8×8 方块，随框旋转）
      ctx.fillStyle = '#38bdf8';
      const handleSize = 10;
      for (const corner of getRotatedCorners(cropBox)) {
        ctx.fillRect(corner.x - handleSize / 2, corner.y - handleSize / 2, handleSize, handleSize);
      }

      // 顶部旋转手柄：连接线 + 圆形手柄
      const topMid = toCanvas(cropBox, 0, -cropBox.h / 2);
      const rotHandle = toCanvas(cropBox, 0, -cropBox.h / 2 - 26);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(topMid.x, topMid.y);
      ctx.lineTo(rotHandle.x, rotHandle.y);
      ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(rotHandle.x, rotHandle.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      // In Step 1, render subtle preview outline for reference
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke(buildRotatedPath(cropBox));
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [isOpen, step, cutoutPos, cutoutScale, blinkVisible, cropBoxScale, cropBoxPos, cropBoxRotation]);

  if (!isOpen) return null;

  // Mouse Drag Handlers based on Step
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    if (step === 'align') {
      // Step 1: Mouse drags Cutout image alignment
      setDragTarget('cutout');
      setDragStart({ x: clickX - cutoutPos.x, y: clickY - cutoutPos.y });
      return;
    }

    // Step 2: 命中检测（优先角点 → 旋转手柄 → 框内）
    const ws = canvasRef.current;
    const cropBox = getCropBoxRect(ws.width, ws.height);
    const { lx, ly } = toLocal(cropBox, clickX, clickY);
    const halfW = cropBox.w / 2;
    const halfH = cropBox.h / 2;

    // 1) 角点手柄（含微小的边缘容差，方便命中）
    const cornerHitDist = 12;
    for (const sx of [1, -1]) {
      for (const sy of [1, -1]) {
        if (Math.abs(lx - sx * halfW) < cornerHitDist && Math.abs(ly - sy * halfH) < cornerHitDist) {
          setDragTarget('resize');
          setDragCorner({ sx, sy });
          return;
        }
      }
    }

    // 2) 顶部旋转手柄（局部 (0, -halfH-26)）
    const rotHandleLocal = { lx: 0, ly: -halfH - 26 };
    if (Math.abs(lx - rotHandleLocal.lx) < 16 && Math.abs(ly - rotHandleLocal.ly) < 16) {
      setDragTarget('rotate');
      return;
    }

    // 3) 框内 → 平移
    if (Math.abs(lx) <= halfW && Math.abs(ly) <= halfH) {
      setDragTarget('cropbox');
      setDragStart({ x: clickX - cropBoxPos.x, y: clickY - cropBoxPos.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const moveX = e.clientX - rect.left;
    const moveY = e.clientY - rect.top;

    // 未拖动时更新悬停光标样式
    if (!dragTarget) {
      if (step === 'crop') {
        const ws = canvasRef.current;
        const cropBox = getCropBoxRect(ws.width, ws.height);
        const { lx, ly } = toLocal(cropBox, moveX, moveY);
        const halfW = cropBox.w / 2;
        const halfH = cropBox.h / 2;
        const cornerHit = [1, -1].some((sx) =>
          [1, -1].some((sy) => Math.abs(lx - sx * halfW) < 12 && Math.abs(ly - sy * halfH) < 12)
        );
        const rotHandleHit = Math.abs(lx) < 16 && Math.abs(ly - (-halfH - 26)) < 16;
        setHoverMode(rotHandleHit ? 'rotate' : cornerHit ? 'resize' : Math.abs(lx) <= halfW && Math.abs(ly) <= halfH ? 'move' : null);
      } else {
        setHoverMode(null);
      }
      return;
    }

    if (dragTarget === 'cutout') {
      setCutoutPos({
        x: moveX - dragStart.x,
        y: moveY - dragStart.y,
      });
    } else if (dragTarget === 'cropbox') {
      const ws = canvasRef.current;
      const newX = moveX - dragStart.x;
      const newY = moveY - dragStart.y;
      setCropBoxPos({ x: newX, y: newY });
    } else if (dragTarget === 'resize') {
      // 拖动角点：以框中心为锚，保持 1:2 比例改变大小
      const ws = canvasRef.current;
      const cropBox = getCropBoxRect(ws.width, ws.height);
      const { lx, ly } = toLocal(cropBox, moveX, moveY);
      const newScale = Math.min(2.0, Math.max(0.4, Math.max(Math.abs(lx) / 125, Math.abs(ly) / 250)));
      setCropBoxScale(newScale);
    } else if (dragTarget === 'rotate') {
      // 拖动旋转手柄：旋转手柄位于框局部 -y 方向（顶部），
      // 其画布方向角 = rotation - 90°，因此需补偿 +90° 使圆柄/中心/鼠标共线
      const ws = canvasRef.current;
      const cropBox = getCropBoxRect(ws.width, ws.height);
      const angle = Math.atan2(moveY - cropBox.cy, moveX - cropBox.cx);
      setCropBoxRotation(angle + Math.PI / 2);
    }
  };

  const handleMouseUp = () => {
    setDragTarget(null);
    setDragCorner(null);
  };

  // 短边对齐 (Short Edge Alignment)
  const handleShortEdgeFit = () => {
    if (!cutoutImgRef.current || !canvasRef.current) return;
    const cImg = cutoutImgRef.current;
    const cropBox = getCropBoxRect(canvasRef.current.width, canvasRef.current.height);
    const { w: baseW, h: baseH } = getBaseRect(cImg.width, cImg.height, canvasRef.current.width, canvasRef.current.height);

    const imgRatio = baseW / baseH;
    const boxRatio = cropBox.w / cropBox.h;

    if (imgRatio > boxRatio) {
      const targetScale = cropBox.h / baseH;
      setCutoutScale(targetScale);
    } else {
      const targetScale = cropBox.w / baseW;
      setCutoutScale(targetScale);
    }
    setCutoutPos({ x: 0, y: 0 });
  };

  // Reset Crop Box
  const handleResetCropBox = () => {
    setCropBoxScale(1.0);
    setCropBoxPos({ x: 0, y: 0 });
    setCropBoxRotation(0);
  };

  // 设置输出画布变换：工作区坐标 → 裁切框局部坐标(逆旋转) → 缩放 → 590x1180 输出坐标
  // p_out = T(centerOut) · S(590/w) · R(-rotation) · T(-center) · p_ws
  const setupOutputTransform = (
    ctx: CanvasRenderingContext2D,
    cropBox: ReturnType<typeof getCropBoxRect>,
    targetW: number,
    targetH: number
  ) => {
    const scaleX = targetW / cropBox.w;
    const scaleY = targetH / cropBox.h;
    ctx.translate(targetW / 2, targetH / 2);
    ctx.scale(scaleX, scaleY);
    ctx.rotate(-cropBox.rotation);
    ctx.translate(-cropBox.cx, -cropBox.cy);
  };

  // Confirm Alignment & Crop Output (Supports overflow with transparent fill)
  const handleSave = () => {
    const targetW = 590;
    const targetH = 1180;
    const wsCanvas = canvasRef.current;
    if (!wsCanvas) return;

    const cropBox = getCropBoxRect(wsCanvas.width, wsCanvas.height);

    // 1. Output Front Photo
    const frontCanvas = document.createElement('canvas');
    frontCanvas.width = targetW;
    frontCanvas.height = targetH;
    const fCtx = frontCanvas.getContext('2d');

    if (fCtx && frontImgRef.current) {
      fCtx.clearRect(0, 0, targetW, targetH);
      const img = frontImgRef.current;
      const { x: dx, y: dy, w: drawW, h: drawH } = getBaseRect(img.width, img.height, wsCanvas.width, wsCanvas.height);

      setupOutputTransform(fCtx, cropBox, targetW, targetH);
      fCtx.drawImage(img, dx, dy, drawW, drawH);
    }

    // 2. Output Cutout Photo
    const cutoutCanvas = document.createElement('canvas');
    cutoutCanvas.width = targetW;
    cutoutCanvas.height = targetH;
    const cCtx = cutoutCanvas.getContext('2d');

    if (cCtx && (cutoutImgRef.current || frontImgRef.current)) {
      cCtx.clearRect(0, 0, targetW, targetH);
      const activeImg = cutoutImgRef.current || frontImgRef.current;

      if (activeImg) {
        const { w: baseW, h: baseH } = getBaseRect(activeImg.width, activeImg.height, wsCanvas.width, wsCanvas.height);
        const dx = (wsCanvas.width - baseW) / 2 + cutoutPos.x;
        const dy = (wsCanvas.height - baseH) / 2 + cutoutPos.y;

        const finalW = baseW * cutoutScale;
        const finalH = baseH * cutoutScale;
        const finalX = dx + (baseW - finalW) / 2;
        const finalY = dy + (baseH - finalH) / 2;

        setupOutputTransform(cCtx, cropBox, targetW, targetH);
        cCtx.drawImage(activeImg, finalX, finalY, finalW, finalH);
      }
    }

    const croppedFrontData = frontCanvas.toDataURL('image/png');
    const croppedCutoutData = cutoutCanvas.toDataURL('image/png');

    onApplyCropped(croppedFrontData, croppedCutoutData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-3xl rounded-2xl bg-slate-900 p-6 border border-slate-800 shadow-2xl text-white space-y-4">
        {/* Header with 2-Step Nav */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-3">
          <div className="flex items-center gap-2">
            <Move className="w-5 h-5 text-blue-400" />
            <h3 className="text-base font-bold">图像预处理与裁切</h3>
          </div>

          {/* Stepper Tabs */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-bold">
            <button
              onClick={() => setStep('align')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                step === 'align'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>1. 原图与抠图对齐</span>
            </button>
            <div className="w-3 h-px bg-slate-700 mx-1" />
            <button
              onClick={() => setStep('crop')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                step === 'crop'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Crop className="w-3.5 h-3.5" />
              <span>2. 框选裁切范围</span>
            </button>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition self-end sm:self-auto"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Workspace Canvas */}
        <div className="flex justify-center overflow-hidden rounded-xl bg-slate-950 p-3 border border-slate-800 select-none">
          <canvas
            ref={canvasRef}
            width={480}
            height={520}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className={`rounded-lg border border-slate-800 shadow-inner ${
              step === 'crop'
                ? hoverMode === 'resize'
                  ? 'cursor-nwse-resize'
                  : hoverMode === 'rotate'
                    ? 'cursor-crosshair'
                    : hoverMode === 'move'
                      ? 'cursor-move'
                      : 'cursor-default'
                : 'cursor-move'
            }`}
          />
        </div>

        {/* Step-Specific Controls */}
        {step === 'align' ? (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-800/60 p-3 rounded-xl border border-slate-800 text-xs">
            {/* Zoom Slider */}
            <div className="flex items-center gap-2 sm:col-span-2">
              <ZoomOut className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-slate-400 text-[11px] shrink-0">抠图缩放:</span>
              <input
                type="range"
                min="0.4"
                max="2.2"
                step="0.02"
                value={cutoutScale}
                onChange={(e) => setCutoutScale(parseFloat(e.target.value))}
                className="w-full accent-blue-500 cursor-pointer"
              />
              <ZoomIn className="w-4 h-4 text-slate-400 shrink-0" />
            </div>

            {/* Short edge fit button */}
            <button
              onClick={handleShortEdgeFit}
              className="flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 rounded-xl font-medium transition"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              短边对齐
            </button>

            {/* Reset position button */}
            <button
              onClick={() => {
                setCutoutPos({ x: 0, y: 0 });
                setCutoutScale(1.0);
              }}
              className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
              重置位移
            </button>

            {/* Blinking toggle button */}
            <button
              onClick={() => setIsBlinking((b) => !b)}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl font-medium transition ${
                isBlinking
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {isBlinking ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              {isBlinking ? '闪烁观察中' : '闪烁已暂停'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-800/60 p-3 rounded-xl border border-slate-800 text-xs">
            {/* Crop Box Zoom Slider */}
            <div className="flex items-center gap-2 sm:col-span-2">
              <ZoomOut className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-slate-400 text-[11px] shrink-0">裁剪框缩放:</span>
              <input
                type="range"
                min="0.4"
                max="2.0"
                step="0.02"
                value={cropBoxScale}
                onChange={(e) => setCropBoxScale(parseFloat(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <ZoomIn className="w-4 h-4 text-slate-400 shrink-0" />
            </div>

            {/* Rotation display & reset */}
            <div className="flex items-center gap-2 justify-end sm:col-span-2">
              <span className="text-slate-300 font-mono shrink-0">
                旋转 {((Math.round((cropBoxRotation * 180) / Math.PI) % 360) + 360) % 360}°
              </span>
              <button
                onClick={() => setCropBoxRotation(0)}
                className={`px-2.5 py-1.5 rounded-lg transition font-medium ${
                  cropBoxRotation === 0
                    ? 'bg-slate-800/50 text-slate-600 cursor-default'
                    : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/40'
                }`}
              >
                旋转归零
              </button>
              <button
                onClick={handleResetCropBox}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition font-medium"
              >
                默认居中
              </button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between border-t border-slate-800 pt-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition text-sm"
          >
            取消
          </button>

          <div className="flex items-center gap-3">
            {step === 'crop' && (
              <button
                onClick={() => setStep('align')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm transition"
              >
                <ArrowLeft className="w-4 h-4" />
                上一步：调整对齐
              </button>
            )}

            {step === 'align' ? (
              <button
                onClick={() => setStep('crop')}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition shadow-lg shadow-blue-500/25"
              >
                <span>下一步：框选裁切</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition shadow-lg shadow-emerald-500/25"
              >
                <Check className="w-4 h-4" />
                完成裁切并应用 (Apply Crop)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
