import React, { useRef, useEffect, useState } from 'react';
import {
  Download,
  Eye,
  Maximize2,
  Minimize2,
  RefreshCw,
  Layers,
  Sparkles,
  Scissors,
  SlidersHorizontal,
  Check,
} from 'lucide-react';
import { E1Options, PassCardInfo, PreviewKind, LayerVisibilityConfig, DEFAULT_LAYER_VISIBILITY } from '../types';
import {
  renderFrontCard,
  renderBackCard,
  renderWhiteCard,
  renderDiecutCard,
  loadImage,
  preloadPsdAssets,
  FONTS_LOADED_EVENT,
  areFontsLoaded,
  CARD_WIDTH,
  CARD_HEIGHT,
} from '../utils/passRenderer';
import { PassPreview3D } from './PassPreview3D';

interface PassPreviewCanvasProps {
  info: PassCardInfo;
  e1Opts: E1Options;
  frontPhotoUrl: string;
  cutoutPhotoUrl: string;
  customIconUrl: string;
  activeKind: PreviewKind;
  onSelectKind: (kind: PreviewKind) => void;
}

export const PassPreviewCanvas: React.FC<PassPreviewCanvasProps> = ({
  info,
  e1Opts,
  frontPhotoUrl,
  cutoutPhotoUrl,
  customIconUrl,
  activeKind,
  onSelectKind,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tab, setTab] = useState<'2d' | '3d'>('2d');
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showDebugLayers, setShowDebugLayers] = useState<boolean>(false);

  // Layer visibility state
  const [layers, setLayers] = useState<LayerVisibilityConfig>(DEFAULT_LAYER_VISIBILITY);

  // 字体加载完成后触发重绘（保证画布文字使用自定义字体）
  const [fontTick, setFontTick] = useState<number>(0);

  // 监听字体加载完成事件 → 立即重新渲染 2D 预览
  useEffect(() => {
    if (tab !== '2d') return;
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
  }, [tab]);

  useEffect(() => {
    if (tab !== '2d') return; // Only render 2D canvas if tab is 2D
    let isMounted = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    async function drawCanvas() {
      setIsRendering(true);

      await preloadPsdAssets();

      const [img1Obj, cutoutObj, customIconObj] = await Promise.all([
        frontPhotoUrl ? loadImage(frontPhotoUrl) : Promise.resolve(null),
        cutoutPhotoUrl ? loadImage(cutoutPhotoUrl) : Promise.resolve(null),
        customIconUrl ? loadImage(customIconUrl) : Promise.resolve(null),
      ]);

      if (!isMounted || !ctx) return;

      switch (activeKind) {
        case 'front':
          await renderFrontCard(ctx, info, img1Obj, e1Opts, customIconObj, layers, cutoutObj, true);
          break;
        case 'back':
          await renderBackCard(ctx, info, cutoutObj, e1Opts, img1Obj, layers, true);
          break;
        case 'white':
          await renderWhiteCard(ctx, info, cutoutObj, e1Opts, img1Obj, customIconObj, layers, true);
          break;
        case 'diecut':
          await renderDiecutCard(ctx);
          break;
      }

      if (isMounted) setIsRendering(false);
    }

    drawCanvas();

    return () => {
      isMounted = false;
    };
  }, [activeKind, info, e1Opts, frontPhotoUrl, cutoutPhotoUrl, customIconUrl, layers, tab, fontTick]);

  const handleToggleLayer = (key: keyof LayerVisibilityConfig) => {
    setLayers((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleDownloadSingle = async () => {
    if (!canvasRef.current) return;

    // 创建临时canvas用于渲染无刀线裁切的版本
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = CARD_WIDTH;
    tempCanvas.height = CARD_HEIGHT;
    const tempCtx = tempCanvas.getContext('2d');

    if (!tempCtx) return;

    const [img1Obj, cutoutObj, customIconObj] = await Promise.all([
      frontPhotoUrl ? loadImage(frontPhotoUrl) : Promise.resolve(null),
      cutoutPhotoUrl ? loadImage(cutoutPhotoUrl) : Promise.resolve(null),
      customIconUrl ? loadImage(customIconUrl) : Promise.resolve(null),
    ]);

    // 根据当前激活的类型渲染无刀线裁切的版本
    switch (activeKind) {
      case 'front':
        await renderFrontCard(tempCtx, info, img1Obj, e1Opts, customIconObj, layers, cutoutObj, false);
        break;
      case 'back':
        await renderBackCard(tempCtx, info, cutoutObj, e1Opts, img1Obj, layers, false);
        break;
      case 'white':
        await renderWhiteCard(tempCtx, info, cutoutObj, e1Opts, img1Obj, customIconObj, layers, false);
        break;
      case 'diecut':
        await renderDiecutCard(tempCtx);
        break;
    }

    const dataUrl = tempCanvas.toDataURL('image/png');
    const kindNames: Record<PreviewKind, string> = {
      front: '正面',
      back: '背面',
      white: '白墨',
      diecut: '刀模',
    };

    const fileName = `PassCard_Generator_${info.english_name || 'card'}_${kindNames[activeKind]}.png`;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = fileName;
    a.click();
  };

  const layerLabels: { key: keyof LayerVisibilityConfig; label: string }[] = [
    { key: 'background', label: '🎨 背景与画布' },
    { key: 'characterPhoto', label: '👤 立绘与人物照片' },
    { key: 'baseboard', label: '🛡️ 精一底板' },
    { key: 'factionWatermark', label: '🏛️ 阵营水印' },
    { key: 'barcode', label: '📊 条形码及编码' },
    { key: 'idAndNameText', label: '🔤 名字与ID' },
    { key: 'professionFactionText', label: '⚔️ 职业/势力' },
    { key: 'borderOverlay', label: '🖼️ 饰边/外框' },
  ];

  return (
    <div className="flex flex-col h-auto min-h-full bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
      {/* Header View Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-blue-400" />
            <h3 className="text-base font-bold text-white">效果预览</h3>
          </div>

          {/* 2D vs 3D Mode Selector */}
          <div className="mode-switch mode-switch-preview" role="group" aria-label="效果预览模式">
            <button
              type="button"
              onClick={() => setTab('2d')}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-semibold ${tab === '2d' ? 'active' : ''}`}
              aria-pressed={tab === '2d'}
            >
              <Sparkles className="w-3.5 h-3.5" />
              2D 平面贴图
            </button>
            <button
              type="button"
              onClick={() => setTab('3d')}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-semibold ${tab === '3d' ? 'active' : ''}`}
              aria-pressed={tab === '3d'}
            >
              <Layers className="w-3.5 h-3.5" />
              3D 真实亚克力
            </button>
          </div>
        </div>

        {/* Render View Selection Buttons */}
        {tab === '2d' && (
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            {[
              { id: 'front', label: '正面', icon: Sparkles },
              { id: 'back', label: '背面', icon: Layers },
              { id: 'white', label: '白墨', icon: Eye },
              { id: 'diecut', label: '刀模', icon: Scissors },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => onSelectKind(id as PreviewKind)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition ${
                  activeKind === id
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === '2d' ? (
        <>
          {/* Main Interactive Canvas Display */}
          <div className={`relative flex-1 flex items-center justify-center min-h-[520px] my-4 p-4 rounded-xl border border-slate-800/80 overflow-auto transition-colors ${
            activeKind === 'white' ? 'bg-slate-300' : 'bg-slate-950/60'
          }`}>
            {isRendering && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs text-xs text-blue-400 gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                渲染中...
              </div>
            )}

            <div className={`relative transition-all duration-300 ${isFullscreen ? 'p-10' : ''}`}>
              <canvas
                ref={canvasRef}
                width={CARD_WIDTH}
                height={CARD_HEIGHT}
                className={`w-auto rounded-none shadow-2xl border transition-all ${
                  isFullscreen ? 'h-[800px] max-h-[90vh]' : 'h-[480px] max-h-[75vh]'
                } ${
                  activeKind === 'white' ? 'border-slate-400 shadow-slate-900/40 bg-white' : 'border-slate-700/60 hover:border-blue-500/50'
                }`}
              />
            </div>
          </div>

          {/* Bottom Footer Action Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <span className="font-mono text-slate-500">尺寸: 590 × 1180 px</span>
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                title="缩放预览"
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>

              <button
                onClick={() => setShowDebugLayers((prev) => !prev)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition ml-2 ${
                  showDebugLayers
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                图层调试
              </button>
            </div>

            <button
              onClick={handleDownloadSingle}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-blue-400 font-medium transition border border-slate-700/60 hover:border-blue-500/50"
            >
              <Download className="w-4 h-4" />
              下载当前版面 ({activeKind === 'front' ? '正面' : activeKind === 'back' ? '背面' : activeKind === 'white' ? '白墨' : '刀模'}.png)
            </button>
          </div>

          {/* Layer Debug Panel */}
          {showDebugLayers && (
            <div className="bg-slate-950 p-4 mt-3 rounded-xl border border-amber-500/30 text-xs space-y-2 animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-bold text-amber-400 flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  图层显隐调试面板
                </span>
                <button
                  onClick={() => setLayers(DEFAULT_LAYER_VISIBILITY)}
                  className="text-[11px] text-slate-400 hover:text-white underline"
                >
                  全部开启
                </button>
              </div>
              <div className="flex flex-col gap-2 pt-1">
                {layerLabels.map(({ key, label }) => (
                  <label
                    key={key}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer select-none transition ${
                      layers[key]
                        ? 'bg-slate-800/80 border-slate-700 text-slate-200'
                        : 'bg-slate-900/40 border-slate-800/60 text-slate-500 line-through'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={layers[key]}
                      onChange={() => handleToggleLayer(key)}
                      className="rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-0"
                    />
                    <span className="truncate">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 min-h-[520px] my-4 rounded-xl border border-slate-800/80 overflow-hidden flex flex-col">
          <PassPreview3D
            info={info}
            e1Opts={e1Opts}
            frontPhotoUrl={frontPhotoUrl}
            cutoutPhotoUrl={cutoutPhotoUrl}
            customIconUrl={customIconUrl}
          />
        </div>
      )}
    </div>
  );
};
