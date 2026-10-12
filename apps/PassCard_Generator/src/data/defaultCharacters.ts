import { CharacterRecord, FactionConfig, ProfessionKey } from '../types';
import rawCharacters from '../../characters.json';

export const PROFESSION_EN_MAP: Record<ProfessionKey, string> = {
  先锋: 'VANGUARD',
  近卫: 'GUARD',
  狙击: 'SNIPER',
  重装: 'DEFENDER',
  医疗: 'MEDIC',
  辅助: 'SUPPORTER',
  术师: 'CASTER',
  特种: 'SPECIALIST',
};

export function getProfessionEnText(profName: string | undefined, profEn?: string): string {
  if (profEn && /^[A-Za-z0-9 ]+$/.test(profEn.trim())) {
    return profEn.trim().toUpperCase();
  }
  if (!profName) return 'GUARD';
  const clean = profName.trim().replace('术士', '术师');
  if (clean in PROFESSION_EN_MAP) {
    return PROFESSION_EN_MAP[clean as ProfessionKey];
  }
  if (/^[A-Za-z0-9 ]+$/.test(clean)) {
    return clean.toUpperCase();
  }
  return 'GUARD';
}

export const FACTION_EN_MAP: Record<string, string> = {
  '罗德岛': 'RHODES ISLAND',
  '卡西米尔': 'KAZIMIERZ',
  '岁': 'SUI',
  '炎': 'YAN',
  '大炎': 'YAN',
  '莱茵生命': 'RHINE LAB',
  '使徒': 'APOSTLES',
  '深海猎人': 'ABYSSAL HUNTERS',
  '萨米': 'SAMI',
  '汐斯塔': 'SIESTA',
  '拉特兰': 'LATERANO',
  '莱塔尼亚': 'LEITHANIEN',
  '萨尔贡': 'SARGON',
  '企鹅物流': 'PENGUIN LOGISTICS',
  '黑钢国际': 'BLACKSTEEL',
  '鲤氏': "LEE'S DETECTIVE AGENCY",
  '鲤氏侦探事务所': "LEE'S DETECTIVE AGENCY",
  '东国': 'HIGASHI',
  'sweep': 'SWEEP',
  'SWEEP': 'SWEEP',
  '叙拉古': 'SIRACUSA',
  '雷姆必拓': 'RIM BILLITON',
  '维多利亚': 'VICTORIA',
  '哥伦比亚': 'COLUMBIA',
  '喀兰贸易': 'KARLAN COMMERCIAL',
  '乌萨斯': 'URSUS',
  '龙门近卫局': 'LUNGMEN',
  '龙门': 'LUNGMEN',
  '巴别塔': 'BABEL',
  '阿戈尔': 'AEGIR',
  '米诺斯': 'MINOS',
  '萨卡兹': 'SARKAZ',
  '卡兹戴尔': 'KAZDEL',
  '玻利瓦尔': 'BOLIVAR',
  '杜林': 'DURIN',
  '虹彩六号': 'RAINBOW SIX',
  '蒙特拉': 'MONSTERA',
  '简律所': 'COURT',
  '蛮鳞': 'BARBARIAN',
};

export function getFactionEnText(factionName: string | undefined, factionEnCustom?: string): string {
  if (factionEnCustom && factionEnCustom.trim()) {
    return factionEnCustom.trim().toUpperCase();
  }
  if (!factionName) return 'RHODES ISLAND';
  const trimmed = factionName.trim();
  if (FACTION_EN_MAP[trimmed]) return FACTION_EN_MAP[trimmed];
  for (const k in FACTION_EN_MAP) {
    if (trimmed.includes(k)) return FACTION_EN_MAP[k];
  }
  if (/^[A-Za-z0-9 '\.\-]+$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return 'RHODES ISLAND';
}

export const DEFAULT_FACTIONS: FactionConfig[] = [
  { name: '罗德岛', code: 'RHODES', symbol: 'shield', primaryColor: '#0099ff' },
  { name: '企鹅物流', code: 'PENGUIN', symbol: 'box', primaryColor: '#ff9900' },
  { name: '龙门', code: 'LUNGMEN', symbol: 'building', primaryColor: '#e60000' },
  { name: '莱茵生命', code: 'RHINE', symbol: 'dna', primaryColor: '#00cc88' },
  { name: '维多利亚', code: 'VICTORIA', symbol: 'crown', primaryColor: '#9933ff' },
  { name: '乌萨斯', code: 'URSUS', symbol: 'compass', primaryColor: '#cc3300' },
  { name: '卡西米尔', code: 'KAZIMIERZ', symbol: 'sun', primaryColor: '#e6b800' },
  { name: '拉特兰', code: 'LATERANO', symbol: 'feather', primaryColor: '#00ccff' },
  { name: '黑钢国际', code: 'BLACKSTEEL', symbol: 'zap', primaryColor: '#333333' },
  { name: '巴别塔', code: 'BABEL', symbol: 'layers', primaryColor: '#800020' },
];

function convertRawCharacter(item: any, idx: number): CharacterRecord {
  let colorStr = '#0d1b2a';
  if (item.chinese_name === '澄闪' || item.english_name === 'Goldenglow') {
    colorStr = '#FF96D2';
  } else if (typeof item.back_color === 'string') {
    colorStr = item.back_color;
  } else if (Array.isArray(item.back_color) && item.back_color.length >= 3) {
    const [r, g, b] = item.back_color;
    if (r === 255 && g === 255 && b === 255) {
      colorStr = '#0d1b2a'; // Standard dark canvas for Arknights pass
    } else {
      const hexR = r.toString(16).padStart(2, '0');
      const hexG = g.toString(16).padStart(2, '0');
      const hexB = b.toString(16).padStart(2, '0');
      colorStr = `#${hexR}${hexG}${hexB}`;
    }
  }

  const rawProf = item.profession === '术士' ? '术师' : item.profession;
  const profKey: ProfessionKey = (rawProf in PROFESSION_EN_MAP) ? (rawProf as ProfessionKey) : '近卫';

  return {
    id: item.id || `R${String(idx + 1).padStart(3, '0')}`,
    chinese_name: item.chinese_name || '',
    english_name: item.english_name || '',
    english_name2: item.english_name2 || '',
    profession: profKey,
    profession_en: item.profession_en || PROFESSION_EN_MAP[profKey] || 'OPERATOR',
    barcode_text: item.barcode_text || item.english_name || item.id || `R${String(idx + 1).padStart(3, '0')}`,
    back_color: colorStr,
    base_color: colorStr,
    show_icon: item.show_icon !== false,
    faction: item.faction || '罗德岛',
    faction_display: item.faction_display || item.faction || '罗德岛',
  };
}

export const DEFAULT_CHARACTERS: CharacterRecord[] = (rawCharacters as any[]).map((item, idx) => convertRawCharacter(item, idx));
