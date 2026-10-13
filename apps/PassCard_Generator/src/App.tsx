import React, { useState, useEffect } from 'react';
import {Archive} from 'lucide-react';
import { CharacterRecord, E1Options, PassCardInfo, PreviewKind } from './types';
import { DEFAULT_CHARACTERS } from './data/defaultCharacters';
import { CharacterDatabasePanel } from './components/CharacterDatabasePanel';
import { PassEditorForm } from './components/PassEditorForm';
import { PassPreviewCanvas } from './components/PassPreviewCanvas';
import { ImageCropperModal } from './components/ImageCropperModal';
import { IconAdjustModal } from './components/IconAdjustModal';
import { BatchExportModal } from './components/BatchExportModal';

const LOCAL_STORAGE_DB_KEY = 'PASS_CARD_GEN_CHARACTERS_V2';

export default function App() {
  // 1. Characters Database State (Loads all 427 characters from characters.json)
  const [characters, setCharacters] = useState<CharacterRecord[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_DB_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length >= DEFAULT_CHARACTERS.length) {
          return parsed;
        }
      }
    } catch (e) {
      console.error(e);
    }
    return DEFAULT_CHARACTERS;
  });

  const defaultChar = DEFAULT_CHARACTERS.find((c) => c.chinese_name === '澄闪') || DEFAULT_CHARACTERS[0];

  const [mode, setMode] = useState<'existing' | 'custom'>('existing');
  const [activeCharacter, setActiveCharacter] = useState<CharacterRecord | null>(defaultChar);

  // 2. Pass Card Info State
  const [info, setInfo] = useState<PassCardInfo>({
    chinese_name: defaultChar.chinese_name,
    english_name: defaultChar.english_name,
    english_name2: defaultChar.english_name2 || '',
    id: defaultChar.id,
    profession: defaultChar.profession,
    profession_en: defaultChar.profession_en,
    barcode_text: defaultChar.barcode_text || defaultChar.english_name,
    back_color: defaultChar.base_color || defaultChar.back_color || '#ff96d2',
    base_color: defaultChar.base_color || defaultChar.back_color || '#ff96d2',
    show_icon: true,
    faction: defaultChar.faction || '维多利亚',
  });

  // 3. E1 Advanced Styling State
  const [e1Opts, setE1Opts] = useState<E1Options>({
    enabled: true,
    faction: defaultChar.faction || '维多利亚',
    iconX: 0,
    iconY: 0,
    iconScale: 1.0,
    gradientEnabled: false,
    frontColor: '#ff96d2',
    gradColor: '#1e3a8a',
  });

  // 4. Photo Upload States
  const [rawFrontPhotoUrl, setRawFrontPhotoUrl] = useState<string>('');
  const [rawCutoutPhotoUrl, setRawCutoutPhotoUrl] = useState<string>('');

  const [frontPhotoUrl, setFrontPhotoUrl] = useState<string>('');
  const [cutoutPhotoUrl, setCutoutPhotoUrl] = useState<string>('');
  const [customIconUrl, setCustomIconUrl] = useState<string>('');

  // 5. Active Preview Kind
  const [activeKind, setActiveKind] = useState<PreviewKind>('front');

  // 6. Modals
  const [isCropModalOpen, setIsCropModalOpen] = useState<boolean>(false);
  const [isIconAdjustModalOpen, setIsIconAdjustModalOpen] = useState<boolean>(false);
  const [isBatchExportModalOpen, setIsBatchExportModalOpen] = useState<boolean>(false);

  // Save character DB to localStorage on changes
  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_DB_KEY, JSON.stringify(characters));
  }, [characters]);

  // When picking a character from DB
  const handleSelectCharacter = (char: CharacterRecord) => {
    const mainColor = char.base_color || char.back_color || '#ff96d2';
    setActiveCharacter(char);
    setInfo({
      chinese_name: char.chinese_name,
      english_name: char.english_name,
      english_name2: char.english_name2 || '',
      id: char.id,
      profession: char.profession,
      profession_en: char.profession_en,
      barcode_text: char.barcode_text || char.english_name,
      back_color: mainColor,
      base_color: mainColor,
      show_icon: char.show_icon !== false,
      faction: char.faction || '罗德岛',
      elite_phase: char.elite_phase || 'E1',
    });
    setE1Opts((prev) => ({
      ...prev,
      faction: char.faction || '罗德岛',
      frontColor: mainColor,
    }));
  };

  const handleFrontPhotoUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      setRawFrontPhotoUrl(url);
      setFrontPhotoUrl(url);
    };
    reader.readAsDataURL(file);
  };

  const handleCutoutPhotoUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      setRawCutoutPhotoUrl(url);
      setCutoutPhotoUrl(url);
    };
    reader.readAsDataURL(file);
  };

  const handleCustomIconUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setCustomIconUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveToDatabase = () => {
    if (!info.english_name || !info.id) {
      alert('请确保填写英文姓名与证件编号！');
      return;
    }

    const newRecord: CharacterRecord = {
      id: info.id,
      chinese_name: info.chinese_name,
      english_name: info.english_name,
      english_name2: info.english_name2,
      profession: info.profession,
      profession_en: info.profession_en,
      barcode_text: info.barcode_text,
      back_color: info.back_color,
      show_icon: info.show_icon,
      faction: info.faction,
    };

    const existingIdx = characters.findIndex((c) => c.id === info.id);
    if (existingIdx >= 0) {
      const updated = [...characters];
      updated[existingIdx] = newRecord;
      setCharacters(updated);
    } else {
      setCharacters([newRecord, ...characters]);
    }
  };

  const handleDeleteCharacter = (id: string) => {
    setCharacters(characters.filter((c) => c.id !== id));
  };

  const handleImportDatabase = (importedRecords: CharacterRecord[]) => {
    setCharacters(importedRecords);
    if (importedRecords.length > 0) {
      handleSelectCharacter(importedRecords[0]);
    }
  };

  const handleResetDefaults = () => {
    if (confirm('确定将角色数据库与界面配置重置为初始内置样例数据吗？')) {
      setCharacters(DEFAULT_CHARACTERS);
      handleSelectCharacter(DEFAULT_CHARACTERS[0]);
    }
  };

  return (
    <div className="passcard-app min-h-screen bg-slate-950 text-slate-100 font-sans antialiased">
      {/* Navbar / Header */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">
                PassCard_Generator
              </h1>

            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsBatchExportModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl pcg-primary text-white font-medium text-xs sm:text-sm transition shadow-lg shadow-purple-500/20"
            >
              <Archive className="w-4 h-4" />
              导出
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Database Panel & Form Controls (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Database Panel */}
            <CharacterDatabasePanel
              characters={characters}
              activeCharacter={activeCharacter}
              mode={mode}
              onModeChange={setMode}
              onSelectCharacter={handleSelectCharacter}
              onSaveToDatabase={handleSaveToDatabase}
              onDeleteCharacter={handleDeleteCharacter}
              onImportDatabase={handleImportDatabase}
              onResetDefaultDatabase={() => {
                setCharacters(DEFAULT_CHARACTERS);
                handleSelectCharacter(DEFAULT_CHARACTERS[0]);
              }}
            />

            {/* Pass Card Editor Form */}
            <PassEditorForm
              info={info}
              e1Opts={e1Opts}
              frontPhotoUrl={frontPhotoUrl}
              cutoutPhotoUrl={cutoutPhotoUrl}
              customIconUrl={customIconUrl}
              onInfoChange={setInfo}
              onE1OptsChange={setE1Opts}
              onFrontPhotoUpload={handleFrontPhotoUpload}
              onCutoutPhotoUpload={handleCutoutPhotoUpload}
              onCustomIconUpload={handleCustomIconUpload}
              onClearCustomIcon={() => setCustomIconUrl('')}
              onOpenCropModal={() => setIsCropModalOpen(true)}
              onOpenIconAdjustModal={() => setIsIconAdjustModalOpen(true)}
            />
          </div>

          {/* Right Column: Live High-Res Canvas Preview (5 cols) */}
          <div className="lg:col-span-5 lg:sticky lg:top-20 lg:h-[calc(100vh-6rem)] overflow-y-auto pb-8">
            <PassPreviewCanvas
              info={info}
              e1Opts={e1Opts}
              frontPhotoUrl={frontPhotoUrl}
              cutoutPhotoUrl={cutoutPhotoUrl}
              customIconUrl={customIconUrl}
              activeKind={activeKind}
              onSelectKind={setActiveKind}
            />
          </div>
        </div>
      </main>

      {/* Modals */}
      <ImageCropperModal
        isOpen={isCropModalOpen}
        onClose={() => setIsCropModalOpen(false)}
        frontPhotoUrl={rawFrontPhotoUrl}
        cutoutPhotoUrl={rawCutoutPhotoUrl}
        onApplyCropped={(front, cutout) => {
          setFrontPhotoUrl(front);
          setCutoutPhotoUrl(cutout);
        }}
      />

      <IconAdjustModal
        isOpen={isIconAdjustModalOpen}
        onClose={() => setIsIconAdjustModalOpen(false)}
        info={info}
        e1Opts={e1Opts}
        frontPhotoUrl={frontPhotoUrl}
        customIconUrl={customIconUrl}
        onApply={(x, y, scale) => {
          setE1Opts({
            ...e1Opts,
            iconX: x,
            iconY: y,
            iconScale: scale,
          });
        }}
      />

      <BatchExportModal
        isOpen={isBatchExportModalOpen}
        onClose={() => setIsBatchExportModalOpen(false)}
        currentInfo={info}
        e1Opts={e1Opts}
        frontPhotoUrl={frontPhotoUrl}
        cutoutPhotoUrl={cutoutPhotoUrl}
        customIconUrl={customIconUrl}
      />
    </div>
  );
}
