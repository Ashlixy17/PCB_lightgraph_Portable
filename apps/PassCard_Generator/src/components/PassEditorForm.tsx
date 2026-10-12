import React from 'react';
import {
  Upload,
  Crop,
  Sliders,
  Palette,
  Shield,
  Barcode,
  CheckSquare,
  Square,
  Sparkles,
  Info,
} from 'lucide-react';
import { E1Options, FactionConfig, PassCardInfo, ProfessionKey } from '../types';
import { DEFAULT_FACTIONS, PROFESSION_EN_MAP, getFactionEnText } from '../data/defaultCharacters';
import { PSD_ASSETS } from '../data/imageAssets';

const getFactionIconDataUrl = (filename: string) =>
  PSD_ASSETS[filename] ?? PSD_ASSETS['中间__阵营图标__罗德岛.png'] ?? '';

export const PRESET_FACTIONS = [
  { zh: '罗德岛', en: 'RHODES ISLAND', icon: getFactionIconDataUrl('中间__阵营图标__罗德岛.png') },
  { zh: '莱茵生命', en: 'RHINE LAB', icon: getFactionIconDataUrl('中间__阵营图标__莱茵生命.png') },
  { zh: '企鹅物流', en: 'PENGUIN LOGISTICS', icon: getFactionIconDataUrl('中间__阵营图标__企鹅物流.png') },
  { zh: '龙门', en: 'LUNGMEN', icon: getFactionIconDataUrl('中间__阵营图标__龙门近卫局.png') },
  { zh: '卡西米尔', en: 'KAZIMIERZ', icon: getFactionIconDataUrl('中间__阵营图标__卡西米尔.png') },
  { zh: '维多利亚', en: 'VICTORIA', icon: getFactionIconDataUrl('中间__阵营图标__维多利亚.png') },
  { zh: '乌萨斯', en: 'URSUS', icon: getFactionIconDataUrl('中间__阵营图标__乌萨斯.png') },
  { zh: '拉特兰', en: 'LATERANO', icon: getFactionIconDataUrl('中间__阵营图标__拉特兰.png') },
  { zh: '黑钢国际', en: 'BLACKSTEEL', icon: getFactionIconDataUrl('中间__阵营图标__黑钢国际.png') },
  { zh: '巴别塔', en: 'BABEL', icon: getFactionIconDataUrl('中间__阵营图标__罗德岛.png') },
  { zh: '叙拉古', en: 'SIRACUSA', icon: getFactionIconDataUrl('中间__阵营图标__叙拉古.png') },
  { zh: '哥伦比亚', en: 'COLUMBIA', icon: getFactionIconDataUrl('中间__阵营图标__哥伦比亚.png') },
  { zh: '喀兰贸易', en: 'KARLAN COMMERCIAL', icon: getFactionIconDataUrl('中间__阵营图标__喀兰贸易.png') },
  { zh: '炎', en: 'YAN', icon: getFactionIconDataUrl('中间__阵营图标__炎.png') },
  { zh: '岁', en: 'SUI', icon: getFactionIconDataUrl('中间__阵营图标__岁.png') },
  { zh: '使徒', en: 'APOSTLES', icon: getFactionIconDataUrl('中间__阵营图标__使徒.png') },
  { zh: '深海猎人', en: 'ABYSSAL HUNTERS', icon: getFactionIconDataUrl('中间__阵营图标__深海猎人.png') },
  { zh: '萨米', en: 'SAMI', icon: getFactionIconDataUrl('中间__阵营图标__萨米.png') },
  { zh: '汐斯塔', en: 'SIESTA', icon: getFactionIconDataUrl('中间__阵营图标__汐斯塔.png') },
  { zh: '莱塔尼亚', en: 'LEITHANIEN', icon: getFactionIconDataUrl('中间__阵营图标__莱塔尼亚.png') },
  { zh: '萨尔贡', en: 'SARGON', icon: getFactionIconDataUrl('中间__阵营图标__萨尔贡.png') },
  { zh: '雷姆必拓', en: 'RIM BILLITON', icon: getFactionIconDataUrl('中间__阵营图标__雷姆必拓.png') },
  { zh: '鲤氏', en: "LEE'S DETECTIVE AGENCY", icon: getFactionIconDataUrl('中间__阵营图标__鲤氏.png') },
  { zh: '东国', en: 'HIGASHI', icon: getFactionIconDataUrl('中间__阵营图标__东国.png') },
  { zh: 'SWEEP', en: 'SWEEP', icon: getFactionIconDataUrl('中间__阵营图标__sweep.png') },
];

interface PassEditorFormProps {
  info: PassCardInfo;
  e1Opts: E1Options;
  frontPhotoUrl: string;
  cutoutPhotoUrl: string;
  customIconUrl: string;
  onInfoChange: (info: PassCardInfo) => void;
  onE1OptsChange: (e1Opts: E1Options) => void;
  onFrontPhotoUpload: (file: File) => void;
  onCutoutPhotoUpload: (file: File) => void;
  onCustomIconUpload: (file: File) => void;
  onClearCustomIcon?: () => void;
  onOpenCropModal: () => void;
  onOpenIconAdjustModal: () => void;
}

export const PassEditorForm: React.FC<PassEditorFormProps> = ({
  info,
  e1Opts,
  frontPhotoUrl,
  cutoutPhotoUrl,
  customIconUrl,
  onInfoChange,
  onE1OptsChange,
  onFrontPhotoUpload,
  onCutoutPhotoUpload,
  onCustomIconUpload,
  onClearCustomIcon,
  onOpenCropModal,
  onOpenIconAdjustModal,
}) => {
  const handleEnglishName1Change = (val: string) => {
    // Python filter: re.sub(r'[^A-Za-z0-9 \'\.-]', '', text)
    const cleaned = val.replace(/[^A-Za-z0-9 \'\.-]/g, '');
    onInfoChange({ ...info, english_name: cleaned });
  };

  const handleProfessionChange = (prof: ProfessionKey) => {
    const en = PROFESSION_EN_MAP[prof] || 'OPERATOR';
    onInfoChange({
      ...info,
      profession: prof,
      profession_en: en,
    });
  };

  return (
    <div className="space-y-5 text-white">
      {/* 1. Image Upload & Preprocessing Box */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-blue-400" />
            <h3 className="text-base font-bold">证件照片与图层</h3>
          </div>
          <button
            onClick={onOpenCropModal}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded-xl border border-blue-500/30 font-medium text-xs transition"
          >
            <Crop className="w-3.5 h-3.5" />
            对齐与裁剪
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Front Photo Input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-400">
              完整图片:
            </label>
            <div className="flex items-center gap-2">
              <label className="flex-1 flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl p-2 cursor-pointer hover:border-slate-700 transition">
                <Upload className="w-4 h-4 text-blue-400 shrink-0" />
                <span className="text-xs text-slate-300 truncate">
                  {frontPhotoUrl ? '已加载正面图片' : '上传照片文件...'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onFrontPhotoUpload(file);
                  }}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Cutout Photo Input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-400">
              抠图图片:
            </label>
            <div className="flex items-center gap-2">
              <label className="flex-1 flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl p-2 cursor-pointer hover:border-slate-700 transition">
                <Upload className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-xs text-slate-300 truncate">
                  {cutoutPhotoUrl ? '已加载抠图透明层' : '上传剪影文件...'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onCutoutPhotoUpload(file);
                  }}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Character Data Info Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <Info className="w-5 h-5 text-amber-400" />
          <h3 className="text-base font-bold">通行证文字与排版</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          {/* Chinese Name */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">干员中文:</label>
            <input
              type="text"
              value={info.chinese_name}
              onChange={(e) => onInfoChange({ ...info, chinese_name: e.target.value })}
              placeholder="例如: 阿米娅"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 transition"
            />
          </div>

          {/* English Name 1 */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              干员英文:
            </label>
            <input
              type="text"
              value={info.english_name}
              onChange={(e) => handleEnglishName1Change(e.target.value)}
              placeholder="例如: AMIYA"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500 transition"
            />
          </div>

          {/* English Name 2 */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">异格英文后缀:</label>
            <input
              type="text"
              value={info.english_name2}
              onChange={(e) => onInfoChange({ ...info, english_name2: e.target.value })}
              placeholder="例如: THE PLANERESHAPER"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-amber-500 transition"
            />
          </div>

          {/* ID Number */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">证件编号:</label>
            <input
              type="text"
              value={info.id}
              onChange={(e) => onInfoChange({ ...info, id: e.target.value })}
              placeholder="例如: R1001"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500 transition"
            />
          </div>

          {/* Profession Dropdown */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">职业中文:</label>
            <select
              value={info.profession}
              onChange={(e) => handleProfessionChange(e.target.value as ProfessionKey)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 transition"
            >
              {Object.keys(PROFESSION_EN_MAP).map((prof) => (
                <option key={prof} value={prof}>
                  {prof}
                </option>
              ))}
            </select>
          </div>

          {/* Profession EN Edit */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">职业英文:</label>
            <input
              type="text"
              value={info.profession_en}
              onChange={(e) =>
                onInfoChange({ ...info, profession_en: e.target.value.toUpperCase() })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-amber-500 transition"
            />
          </div>
        </div>

        {/* Faction Selection & Custom Icon Section */}
        <div className="pt-3 border-t border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-slate-200 font-bold">阵营与图标选择:</span>
            </div>

            <button
              type="button"
              onClick={onOpenIconAdjustModal}
              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition"
            >
              <Sliders className="w-3.5 h-3.5" />
              微调图标位置与尺寸
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {/* Preset Faction Selection */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">阵营选择:</label>
              <select
                value={
                  PRESET_FACTIONS.find(
                    (f) => f.zh === info.faction || (info.faction && f.zh.includes(info.faction))
                  )?.zh || '自定义'
                }
                onChange={(e) => {
                  const selected = PRESET_FACTIONS.find((f) => f.zh === e.target.value);
                  if (selected) {
                    onInfoChange({
                      ...info,
                      faction: selected.zh,
                      faction_en: selected.en,
                    });
                  }
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-amber-500 transition"
              >
                {PRESET_FACTIONS.map((f) => (
                  <option key={f.zh} value={f.zh}>
                    {f.zh} — {f.en}
                  </option>
                ))}
                <option value="自定义">自定义</option>
              </select>
            </div>

            {/* Faction EN Edit */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">阵营英文:</label>
              <input
                type="text"
                value={info.faction_en !== undefined ? info.faction_en : getFactionEnText(info.faction)}
                onChange={(e) =>
                  onInfoChange({ ...info, faction_en: e.target.value.toUpperCase() })
                }
                placeholder="如 RHODES ISLAND"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-amber-500 transition"
              />
            </div>
          </div>

          {/* Faction Watermark Preview & Custom Icon Upload Row */}
          <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-900 border border-slate-800 p-1 flex items-center justify-center shrink-0 overflow-hidden">
                <img
                  src={
                    customIconUrl ||
                    PRESET_FACTIONS.find((f) => f.zh === info.faction || (info.faction && f.zh.includes(info.faction)))?.icon ||
                    PSD_ASSETS['中间__阵营图标__罗德岛.png']
                  }
                  alt="Faction Icon Preview"
                  className="max-w-full max-h-full object-contain invert"
                  onError={(e) => {
                    (e.target as HTMLElement).style.opacity = '0.4';
                  }}
                />
              </div>

              <div>
                <span className="block text-xs font-semibold text-slate-200">
                  {customIconUrl ? '已上传自定义阵营图标' : `阵营图标: ${info.faction || '罗德岛'}`}
                </span>
                <span className="block text-[11px] text-slate-400">
                  {customIconUrl ? '已加载自定义 PNG 图标 overlay' : `${getFactionEnText(info.faction)} 矢量水印层`}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 rounded-xl font-medium text-xs cursor-pointer transition">
                <Upload className="w-3.5 h-3.5" />
                上传自定义阵营图标
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onCustomIconUpload(file);
                  }}
                  className="hidden"
                />
              </label>

              {customIconUrl && onClearCustomIcon && (
                <button
                  type="button"
                  onClick={onClearCustomIcon}
                  className="px-2.5 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-medium transition"
                >
                  恢复预置
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Barcode & Color Row */}
        <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-800">
          {/* Custom Barcode Input */}
          <div className="space-y-1.5">
            <label className="block text-xs text-slate-400 flex items-center gap-1">
              <Barcode className="w-4 h-4 text-slate-400" /> 条形码文本:
            </label>
            <input
              type="text"
              value={info.barcode_text}
              onChange={(e) => onInfoChange({ ...info, barcode_text: e.target.value })}
              placeholder="留空则自动跟随英文主名"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-amber-500 transition"
            />
          </div>

          {/* Card Base Color Picker */}
          <div className="space-y-1.5">
            <label className="block text-xs text-slate-400 flex items-center gap-1">
              <Palette className="w-4 h-4 text-purple-400" /> 卡面基础色彩:
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={info.base_color || info.back_color || '#003466'}
                onChange={(e) => {
                  const newColor = e.target.value;
                  onInfoChange({ ...info, base_color: newColor, back_color: newColor });
                  onE1OptsChange({ ...e1Opts, frontColor: newColor });
                }}
                className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border border-slate-700"
              />
              <div className="flex flex-col">
                <span className="font-mono text-xs text-slate-300">
                  {info.base_color || info.back_color || '#003466'}
                </span>
                <span className="text-[11px] text-slate-400">
                  用于精一底板、条形码/文字及背面剪影
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Elite Phase Toggle */}
        <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-slate-200 font-bold">精英阶段:</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              精一: 包含底部底板与阵营水纹 | 精二: 铺满全画幅立绘
            </p>
          </div>
          <div className="inline-flex bg-slate-950 p-1 rounded-xl border border-slate-800 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => onInfoChange({ ...info, elite_phase: 'E1' })}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                (info.elite_phase || 'E1') === 'E1'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              精一
            </button>
            <button
              type="button"
              onClick={() => onInfoChange({ ...info, elite_phase: 'E2' })}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                info.elite_phase === 'E2'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              精二
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
