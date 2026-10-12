export type ProfessionKey = '先锋' | '近卫' | '狙击' | '重装' | '医疗' | '辅助' | '术师' | '特种';

export interface CharacterRecord {
  id: string;
  chinese_name: string;
  english_name: string;
  english_name2?: string;
  profession: ProfessionKey;
  profession_en: string;
  barcode_text?: string;
  back_color?: string; // Hex e.g. "#ffffff" or "#1a1a2e"
  base_color?: string; // Hex e.g. "#003466" - Base theme color for E1 baseboard & barcode
  show_icon?: boolean;
  faction?: string;
  faction_display?: string;
  elite_phase?: 'E1' | 'E2';
  avatar_url?: string;
  cutout_url?: string;
}

export interface FactionConfig {
  name: string;
  code: string;
  symbol: string; // Icon identifier or SVG shape
  primaryColor: string;
}

export interface E1Options {
  enabled: boolean;
  faction: string;
  customIcon?: string; // base64 or URL
  iconX: number; // -150 to +150
  iconY: number; // -150 to +150
  iconScale: number; // 0.3 to 2.5
  gradientEnabled: boolean;
  frontColor: string; // Hex
  gradColor: string; // Hex
}

export interface LayerVisibilityConfig {
  background: boolean;
  characterPhoto: boolean;
  baseboard: boolean;
  factionWatermark: boolean;
  barcode: boolean;
  idAndNameText: boolean;
  professionFactionText: boolean;
  borderOverlay: boolean;
}

export const DEFAULT_LAYER_VISIBILITY: LayerVisibilityConfig = {
  background: true,
  characterPhoto: true,
  baseboard: true,
  factionWatermark: true,
  barcode: true,
  idAndNameText: true,
  professionFactionText: true,
  borderOverlay: true,
};

export interface PassCardInfo {
  chinese_name: string;
  english_name: string;
  english_name2: string;
  id: string;
  profession: ProfessionKey;
  profession_en: string;
  barcode_text: string;
  back_color?: string;
  base_color?: string; // Main theme color for E1 baseboard & barcode/text in E1 mode
  show_icon: boolean;
  faction: string;
  faction_en?: string;
  elite_phase?: 'E1' | 'E2';
}

export type PreviewKind = 'front' | 'back' | 'white' | 'diecut';

export interface ImageCropResult {
  image1: string; // Data URL or Object URL for front photo
  cutout: string; // Data URL or Object URL for cutout photo
}
