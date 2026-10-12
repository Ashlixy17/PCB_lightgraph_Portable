import React, { useState } from 'react';
import { X, Download, Archive, Loader2, Layers } from 'lucide-react';
import JSZip from 'jszip';
import { CharacterRecord, E1Options, PassCardInfo } from '../types';
import {
  renderFrontCard,
  renderBackCard,
  renderWhiteCard,
  renderDiecutCard,
  loadImage,
  preloadPsdAssets,
  CARD_WIDTH,
  CARD_HEIGHT,
} from '../utils/passRenderer';

interface BatchExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentInfo: PassCardInfo;
  e1Opts: E1Options;
  frontPhotoUrl: string;
  cutoutPhotoUrl: string;
  customIconUrl: string;
}

export const BatchExportModal: React.FC<BatchExportModalProps> = ({
  isOpen,
  onClose,
  currentInfo,
  e1Opts,
  frontPhotoUrl,
  cutoutPhotoUrl,
  customIconUrl,
}) => {
  const [exportKinds, setExportKinds] = useState<{
    front: boolean;
    back: boolean;
    white: boolean;
    diecut: boolean;
  }>({
    front: true,
    back: true,
    white: true,
    diecut: true,
  });

  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [progressMsg, setProgressMsg] = useState<string>('');

  if (!isOpen) return null;

  const handleStartBatchExport = async () => {
    setIsGenerating(true);
    setProgressMsg('正在准备资源...');

    try {
      const zip = new JSZip();
      const canvas = document.createElement('canvas');
      canvas.width = CARD_WIDTH;
      canvas.height = CARD_HEIGHT;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('无法创建 Canvas 2D 绘图上下文');
      }

      const img1Obj = frontPhotoUrl ? await loadImage(frontPhotoUrl) : null;
      const cutoutObj = cutoutPhotoUrl ? await loadImage(cutoutPhotoUrl) : null;
      const customIconObj = customIconUrl ? await loadImage(customIconUrl) : null;

      const folderName = `${currentInfo.english_name || currentInfo.id}_${currentInfo.chinese_name || ''}`.replace(/[\\/:*?"<>|]/g, '');
      const folder = zip.folder(folderName) || zip;

      setProgressMsg(`正在生成 ${currentInfo.english_name || '通行证'}...`);

      // 1. 正面.png
      if (exportKinds.front) {
        ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
        await renderFrontCard(ctx, currentInfo, img1Obj, e1Opts, customIconObj, undefined, cutoutObj, false);
        const dataUrl = canvas.toDataURL('image/png');
        folder.file('正面.png', dataUrl.split(',')[1], { base64: true });
      }

      // 2. 背面.png
      if (exportKinds.back) {
        ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
        await renderBackCard(ctx, currentInfo, cutoutObj, e1Opts, img1Obj, undefined, false);
        const dataUrl = canvas.toDataURL('image/png');
        folder.file('背面.png', dataUrl.split(',')[1], { base64: true });
      }

      // 3. 白墨.png
      if (exportKinds.white) {
        ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
        await renderWhiteCard(ctx, currentInfo, cutoutObj, e1Opts, img1Obj, customIconObj, undefined, false);
        const dataUrl = canvas.toDataURL('image/png');
        folder.file('白墨.png', dataUrl.split(',')[1], { base64: true });
      }

      // 4. 刀模.png
      if (exportKinds.diecut) {
        ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
        await renderDiecutCard(ctx);
        const dataUrl = canvas.toDataURL('image/png');
        folder.file('刀模.png', dataUrl.split(',')[1], { base64: true });
      }

      setProgressMsg('正在打包 ZIP 压缩包...');
      const blob = await zip.generateAsync({ type: 'blob' });

      // Trigger File Download
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `PassCard_Generator_${currentInfo.english_name || '未知'}.zip`;
      link.click();
      URL.revokeObjectURL(link.href);

      setProgressMsg('导出成功！');
      setTimeout(() => {
        setIsGenerating(false);
        onClose();
      }, 1000);
    } catch (err: any) {
      console.error(err);
      alert('生成过程中发生错误: ' + err.message);
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl rounded-2xl bg-slate-900 p-6 border border-slate-800 shadow-2xl text-white">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Archive className="w-5 h-5 text-purple-400" />
            <h3 className="text-lg font-bold">通行证打包与导出</h3>
          </div>
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Options */}
        <div className="my-4 space-y-4">
          <div className="bg-slate-800/40 p-3 rounded-xl border border-slate-800">
            <h4 className="text-sm font-semibold text-slate-300 mb-2 flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" /> 选择输出版面文件:
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {[
                { key: 'front', label: '正面' },
                { key: 'back', label: '背面' },
                { key: 'white', label: '白墨' },
                { key: 'diecut', label: '刀模' },
              ].map(({ key, label }) => (
                <label
                  key={key}
                  className="flex items-center gap-2 bg-slate-900/60 p-2.5 rounded-lg border border-slate-700/50 cursor-pointer hover:bg-slate-800/80 transition"
                >
                  <input
                    type="checkbox"
                    checked={exportKinds[key as keyof typeof exportKinds]}
                    onChange={(e) =>
                      setExportKinds({
                        ...exportKinds,
                        [key]: e.target.checked,
                      })
                    }
                    className="accent-purple-500 rounded"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          </div>
        {/* Progress indicator */}
        {isGenerating && (
          <div className="my-3 flex items-center gap-3 p-3 bg-purple-950/50 border border-purple-800/50 rounded-xl text-purple-200 text-xs">
            <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
            <span>{progressMsg}</span>
          </div>
        )}

        {/* Footer Actions */}
        <div className="mt-4 flex justify-end gap-3 border-t border-slate-800 pt-4">
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="px-4 py-2 rounded-xl text-slate-300 hover:bg-slate-800 transition text-sm disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleStartBatchExport}
            disabled={isGenerating}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-sm transition shadow-lg shadow-purple-500/25 disabled:opacity-50"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            打包生成并下载 ZIP
          </button>
        </div>
      </div>
    </div>
  );
};
