import React, { useState, useEffect } from 'react';
import { X, Check, Sliders, Move, Maximize } from 'lucide-react';
import { E1Options, PassCardInfo } from '../types';
import { renderFrontCard, loadImage, CARD_WIDTH, CARD_HEIGHT } from '../utils/passRenderer';

interface IconAdjustModalProps {
  isOpen: boolean;
  onClose: () => void;
  info: PassCardInfo;
  e1Opts: E1Options;
  frontPhotoUrl: string;
  customIconUrl: string;
  onApply: (iconX: number, iconY: number, iconScale: number) => void;
}

export const IconAdjustModal: React.FC<IconAdjustModalProps> = ({
  isOpen,
  onClose,
  info,
  e1Opts,
  frontPhotoUrl,
  customIconUrl,
  onApply,
}) => {
  const [iconX, setIconX] = useState<number>(e1Opts.iconX || 0);
  const [iconY, setIconY] = useState<number>(e1Opts.iconY || 0);
  const [iconScale, setIconScale] = useState<number>(e1Opts.iconScale || 1.0);

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setIconX(e1Opts.iconX || 0);
    setIconY(e1Opts.iconY || 0);
    setIconScale(e1Opts.iconScale || 1.0);
  }, [isOpen, e1Opts]);

  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isSubscribed = true;

    async function drawPreview() {
      const img1Obj = frontPhotoUrl ? await loadImage(frontPhotoUrl) : null;
      const customIconObj = customIconUrl ? await loadImage(customIconUrl) : null;

      if (!isSubscribed || !ctx) return;

      const tempE1: E1Options = {
        ...e1Opts,
        iconX,
        iconY,
        iconScale,
      };

      renderFrontCard(ctx, info, img1Obj, tempE1, customIconObj);
    }

    drawPreview();

    return () => {
      isSubscribed = false;
    };
  }, [isOpen, info, e1Opts, frontPhotoUrl, customIconUrl, iconX, iconY, iconScale]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-xl rounded-2xl bg-slate-900 p-6 border border-slate-800 shadow-2xl text-white">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-emerald-400" />
            <h3 className="text-lg font-bold">图标位置与缩放微调</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Layout */}
        <div className="my-4 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          {/* Live Mini Preview Canvas */}
          <div className="flex flex-col items-center justify-center bg-slate-950 p-3 rounded-xl border border-slate-800">
            <canvas
              ref={canvasRef}
              width={CARD_WIDTH}
              height={CARD_HEIGHT}
              className="w-full max-w-[200px] h-auto rounded-lg shadow-lg border border-slate-700/50"
            />
            <span className="mt-2 text-xs text-slate-400">实时渲染预览</span>
          </div>

          {/* Sliders Form */}
          <div className="space-y-5 bg-slate-800/40 p-4 rounded-xl border border-slate-800 text-sm">
            {/* X Offset */}
            <div>
              <div className="flex justify-between items-center mb-1 text-slate-300">
                <span className="flex items-center gap-1">
                  <Move className="w-4 h-4 text-blue-400" /> 水平偏移 (X):
                </span>
                <span className="font-mono text-blue-400 font-bold">{iconX} px</span>
              </div>
              <input
                type="range"
                min="-150"
                max="150"
                value={iconX}
                onChange={(e) => setIconX(parseInt(e.target.value, 10))}
                className="w-full accent-blue-500 cursor-pointer"
              />
            </div>

            {/* Y Offset */}
            <div>
              <div className="flex justify-between items-center mb-1 text-slate-300">
                <span className="flex items-center gap-1">
                  <Move className="w-4 h-4 rotate-90 text-emerald-400" /> 垂直偏移 (Y):
                </span>
                <span className="font-mono text-emerald-400 font-bold">{iconY} px</span>
              </div>
              <input
                type="range"
                min="-150"
                max="150"
                value={iconY}
                onChange={(e) => setIconY(parseInt(e.target.value, 10))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
            </div>

            {/* Scale Ratio */}
            <div>
              <div className="flex justify-between items-center mb-1 text-slate-300">
                <span className="flex items-center gap-1">
                  <Maximize className="w-4 h-4 text-amber-400" /> 缩放比例 (Scale):
                </span>
                <span className="font-mono text-amber-400 font-bold">
                  {Math.round(iconScale * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="30"
                max="250"
                value={Math.round(iconScale * 100)}
                onChange={(e) => setIconScale(parseFloat(e.target.value) / 100)}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>

            <button
              onClick={() => {
                setIconX(0);
                setIconY(0);
                setIconScale(1.0);
              }}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 rounded-lg transition"
            >
              重置图标参数
            </button>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-4 flex justify-end gap-3 border-t border-slate-800 pt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-slate-300 hover:bg-slate-800 transition text-sm"
          >
            取消
          </button>
          <button
            onClick={() => {
              onApply(iconX, iconY, iconScale);
              onClose();
            }}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition shadow-lg shadow-emerald-500/25"
          >
            <Check className="w-4 h-4" />
            保存微调参数
          </button>
        </div>
      </div>
    </div>
  );
};
