import React, { useState } from 'react';
import { Search, UserCheck, PlusCircle, Database, Download, Upload, RotateCcw } from 'lucide-react';
import { CharacterRecord } from '../types';

interface CharacterDatabasePanelProps {
  characters: CharacterRecord[];
  activeCharacter: CharacterRecord | null;
  mode: 'existing' | 'custom';
  onModeChange: (mode: 'existing' | 'custom') => void;
  onSelectCharacter: (char: CharacterRecord) => void;
  onSaveToDatabase: (record: CharacterRecord) => void;
  onDeleteCharacter: (id: string) => void;
  onImportDatabase: (records: CharacterRecord[]) => void;
  onResetDefaultDatabase?: () => void;
}

export const CharacterDatabasePanel: React.FC<CharacterDatabasePanelProps> = ({
  characters,
  activeCharacter,
  mode,
  onModeChange,
  onSelectCharacter,
  onSaveToDatabase,
  onDeleteCharacter,
  onImportDatabase,
  onResetDefaultDatabase,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');

  const filteredCharacters = characters.filter((c) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      c.chinese_name.toLowerCase().includes(term) ||
      c.english_name.toLowerCase().includes(term) ||
      c.id.toLowerCase().includes(term) ||
      (c.faction && c.faction.toLowerCase().includes(term))
    );
  });

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const json = JSON.parse(evt.target?.result as string);
        if (Array.isArray(json)) {
          onImportDatabase(json);
          alert(`成功导入 ${json.length} 条角色数据！`);
        }
      } catch (err) {
        alert('导入数据格式错误，请输入正确的 JSON 文件');
      }
    };
    reader.readAsText(file);
  };

  const handleExportFile = () => {
    const jsonStr = JSON.stringify(characters, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PassCard_Generator_角色数据库_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl text-white space-y-4">
      {/* Title & Mode Switch */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-amber-400" />
          <h3 className="text-base font-bold">角色与数据来源</h3>
        </div>

        {/* Radio Mode Tabs */}
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => onModeChange('existing')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition ${
              mode === 'existing'
                ? 'bg-amber-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            原版干员
          </button>
          <button
            onClick={() => onModeChange('custom')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition ${
              mode === 'custom'
                ? 'bg-amber-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            自定义
          </button>
        </div>
      </div>

      {mode === 'existing' ? (
        <div className="space-y-3">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="搜索角色姓名 / 英文名 / 编号 / 阵营..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500/50 transition"
            />
          </div>

          {/* Quick Select Character Dropdown */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              选择人物档案 ({filteredCharacters.length} 项匹配):
            </label>
            <select
              value={activeCharacter?.id || ''}
              onChange={(e) => {
                const picked = characters.find((c) => c.id === e.target.value);
                if (picked) onSelectCharacter(picked);
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-amber-300 font-medium focus:outline-none focus:border-amber-500 transition"
            >
              {filteredCharacters.map((c, idx) => (
                <option key={`${c.id}-${c.chinese_name}-${idx}`} value={c.id}>
                  {c.chinese_name || c.english_name} / {c.english_name} / {c.id} ({c.profession})
                </option>
              ))}
            </select>
          </div>

          {/* Preset Cards Grid Preview */}
          <div className="max-h-36 overflow-y-auto grid grid-cols-2 gap-2 pt-1 pr-1">
            {filteredCharacters.map((c, idx) => {
              const isSelected = activeCharacter?.id === c.id;
              return (
                <div
                  key={`${c.id}-${c.chinese_name}-${idx}`}
                  onClick={() => onSelectCharacter(c)}
                  className={`p-2 rounded-xl border text-left cursor-pointer transition flex items-center justify-between ${
                    isSelected
                      ? 'pcg-selected'
                      : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:bg-slate-800/60'
                  }`}
                >
                  <div>
                    <div className="font-bold text-xs text-white">
                      {c.chinese_name || c.english_name}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      {c.english_name} • {c.id}
                    </div>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                    {c.profession}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded-xl text-xs text-amber-200/90 leading-relaxed">
          💡 当前模式：自定义录入。你可以在下方表单中自由编辑照片、姓名、编号与干员职业。勾选【保存新编辑条目至数据库】后点击生成，即可将新角色永久收录至数据库！
        </div>
      )}

      {/* Loaded count indicator */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs text-slate-500">
        <span className="font-medium">已载入 {characters.length} 名干员</span>
      </div>
    </div>
  );
};
