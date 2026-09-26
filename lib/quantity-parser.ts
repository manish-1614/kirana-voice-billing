/**
 * Kirana Voice Billing — Deterministic Colloquial Quantity Parser
 * 
 * Accurately parses regional Hinglish and colloquial North-Indian / Ranchi quantity phrases
 * (e.g. "1 paav", "dhai-sau gram", "sawa do kilo", "dedh kilo", "aadha darjan", "500 ml")
 * and normalizes them into standard numeric units matching the catalog item's base unit_type.
 * 
 * Also performs strict unit category compatibility checking (weight vs liquid vs count)
 * to reject nonsense inputs like "aadha kilo" for a packaged tea packet.
 */

export type CatalogUnitType = 'kg' | 'g' | 'litre' | 'piece' | 'packet';

export type UnitCategory = 'weight' | 'liquid' | 'count';

export interface ParseResult {
  valid: boolean;
  normalizedQuantity: number;
  targetUnit: CatalogUnitType;
  spokenLabel: string;
  category: UnitCategory;
  error?: string;
  errorMessage?: string;
}

const HINDI_NUMBER_WORDS: Record<string, number> = {
  'aadha': 0.5,
  'adha': 0.5,
  'half': 0.5,
  'paav': 0.25,
  'dedh': 1.5,
  'derh': 1.5,
  'dhai': 2.5,
  'dhayi': 2.5,
  'ek': 1,
  'one': 1,
  'do': 2,
  'two': 2,
  'teen': 3,
  'three': 3,
  'chaar': 4,
  'char': 4,
  'four': 4,
  'paanch': 5,
  'panch': 5,
  'five': 5,
  'chhah': 6,
  'chhe': 6,
  'six': 6,
  'saat': 7,
  'seven': 7,
  'aath': 8,
  'eight': 8,
  'nau': 9,
  'nine': 9,
  'das': 10,
  'ten': 10,
  'gyarah': 11,
  'barah': 12,
  'terah': 13,
  'chaudah': 14,
  'pandrah': 15,
  'solah': 16,
  'satrah': 17,
  'atharah': 18,
  'unnees': 19,
  'bees': 20,
  'pachees': 25,
  'pachas': 50,
  'pachaas': 50,
  'sau': 100,
  'hazaar': 1000,
  'hazar': 1000,
};

export function getUnitCategory(unit: CatalogUnitType): UnitCategory {
  switch (unit) {
    case 'kg':
    case 'g':
      return 'weight';
    case 'litre':
      return 'liquid';
    case 'piece':
    case 'packet':
      return 'count';
  }
}

/**
 * Parses raw spoken quantity text into a numeric quantity and unit category.
 */
export function parseSpokenQuantity(rawText: string, catalogUnitType: CatalogUnitType): ParseResult {
  const text = rawText.toLowerCase().trim().replace(/[-_]/g, ' ');
  const targetCategory = getUnitCategory(catalogUnitType);

  // 1. Check for Dozen phrases ("ek darjan", "aadha darjan", "2 darjan")
  if (text.includes('darjan') || text.includes('dozen')) {
    if (targetCategory !== 'count') {
      return mismatchResult(rawText, 'count', targetCategory, catalogUnitType);
    }
    let count = 12;
    if (text.includes('aadha') || text.includes('adha') || text.includes('half')) {
      count = 6;
    } else {
      const match = text.match(/(\d+|ek|do|teen|char|paanch)/);
      if (match) {
        const factor = HINDI_NUMBER_WORDS[match[1]] ?? parseFloat(match[1]) ?? 1;
        count = factor * 12;
      }
    }
    return {
      valid: true,
      normalizedQuantity: count,
      targetUnit: catalogUnitType,
      spokenLabel: rawText,
      category: 'count',
    };
  }

  // 2. Colloquial Paav variants (1 paav = 0.25 kg)
  const paavMatch = text.match(/(?:(\d+|ek|do|teen|char|paanch|aadha|adha)\s*)?paav/);
  if (paavMatch) {
    if (targetCategory !== 'weight') {
      return mismatchResult(rawText, 'weight', targetCategory, catalogUnitType);
    }
    const multiplierStr = paavMatch[1] || 'ek';
    const multiplier = HINDI_NUMBER_WORDS[multiplierStr] ?? parseFloat(multiplierStr) ?? 1;
    const kgAmount = round(multiplier * 0.25, 3);
    const normalized = catalogUnitType === 'kg' ? kgAmount : kgAmount * 1000;
    return {
      valid: true,
      normalizedQuantity: normalized,
      targetUnit: catalogUnitType,
      spokenLabel: rawText,
      category: 'weight',
    };
  }

  // 3. Explicit Gram phrases: "dhai sau gram", "dedh sau gram", "500 gm", "sau gram"
  // (Must be checked before compound kilos so "dhai sau gram" isn't parsed as 2.5 kg)
  if (text.includes('gram') || text.includes('gm') || text.includes('grm') || text.match(/\b\d+\s*g\b/)) {
    if (targetCategory !== 'weight') {
      return mismatchResult(rawText, 'weight', targetCategory, catalogUnitType);
    }

    let grams = 0;
    if (text.includes('dhai sau') || text.includes('dhaisau')) {
      grams = 250;
    } else if (text.includes('dedh sau') || text.includes('derh sau')) {
      grams = 150;
    } else if (text.includes('paanch sau')) {
      grams = 500;
    } else if (text.includes('char sau')) {
      grams = 400;
    } else if (text.includes('teen sau')) {
      grams = 300;
    } else if (text.includes('do sau')) {
      grams = 200;
    } else if (text.match(/\bsau\b/) && !text.match(/\d/)) {
      grams = 100;
    } else {
      const numMatch = text.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) {
        grams = parseFloat(numMatch[1]);
      }
    }

    const normalized = catalogUnitType === 'kg' ? round(grams / 1000, 3) : grams;
    return {
      valid: true,
      normalizedQuantity: normalized,
      targetUnit: catalogUnitType,
      spokenLabel: rawText,
      category: 'weight',
    };
  }

  // 4. Standalone Paun kilo / Pauna kilo (0.75 kg)
  // Uses word boundaries so "paune do" doesn't trigger this!
  if (text.match(/\bpaun\b|\bpauna\b/)) {
    if (targetCategory !== 'weight') {
      return mismatchResult(rawText, 'weight', targetCategory, catalogUnitType);
    }
    const normalized = catalogUnitType === 'kg' ? 0.75 : 750;
    return {
      valid: true,
      normalizedQuantity: normalized,
      targetUnit: catalogUnitType,
      spokenLabel: rawText,
      category: 'weight',
    };
  }

  // 5. Colloquial Compound Quantities:
  // - "sawa X" = X + 0.25
  // - "dedh" = 1.5
  // - "dhai" = 2.5
  // - "sadhe X" = X + 0.5
  // - "paune X" = X - 0.25
  const compoundMatch = text.match(/(sawa|sadhe|paune|dedh|derh|dhai)\s*(\d+|ek|do|teen|char|paanch|chhah|saat|aath|nau|das)?/);
  if (compoundMatch) {
    const prefix = compoundMatch[1];
    const baseWord = compoundMatch[2];
    let value = 0;

    if (prefix === 'dedh' || prefix === 'derh') {
      value = 1.5;
    } else if (prefix === 'dhai') {
      value = 2.5;
    } else {
      const baseNum = baseWord ? (HINDI_NUMBER_WORDS[baseWord] ?? parseFloat(baseWord) ?? 1) : 1;
      if (prefix === 'sawa') value = baseNum + 0.25;
      else if (prefix === 'sadhe') value = baseNum + 0.5;
      else if (prefix === 'paune') value = baseNum - 0.25;
    }

    // Determine category based on keywords
    const detectedCategory = detectCategoryFromText(text, targetCategory);
    if (detectedCategory !== targetCategory) {
      return mismatchResult(rawText, detectedCategory, targetCategory, catalogUnitType);
    }

    let normalized = value;
    if (targetCategory === 'weight' && catalogUnitType === 'g') {
      normalized = value * 1000;
    }

    return {
      valid: true,
      normalizedQuantity: round(normalized, 3),
      targetUnit: catalogUnitType,
      spokenLabel: rawText,
      category: targetCategory,
    };
  }

  // 6. Explicit Liquid phrases: "ml", "mili litre", "litre", "liter"
  if (text.includes('litre') || text.includes('liter') || text.includes('ltr') || text.includes('ml')) {
    if (targetCategory !== 'liquid') {
      return mismatchResult(rawText, 'liquid', targetCategory, catalogUnitType);
    }

    let litres = 0;
    if (text.includes('ml')) {
      const numMatch = text.match(/(\d+(?:\.\d+)?)/);
      const ml = numMatch ? parseFloat(numMatch[1]) : 500;
      litres = ml / 1000;
    } else if (text.includes('aadha') || text.includes('adha') || text.includes('half')) {
      litres = 0.5;
    } else {
      const num = extractLeadingNumber(text);
      litres = num || 1;
    }

    return {
      valid: true,
      normalizedQuantity: round(litres, 3),
      targetUnit: catalogUnitType,
      spokenLabel: rawText,
      category: 'liquid',
    };
  }

  // 7. General Standard Forms: e.g. "aadha kilo", "1 kilo", "2 packet", "5 piece"
  const detectedCat = detectCategoryFromText(text, targetCategory);
  if (detectedCat !== targetCategory) {
    return mismatchResult(rawText, detectedCat, targetCategory, catalogUnitType);
  }

  let quantity = extractLeadingNumber(text) || 1;

  if (targetCategory === 'weight') {
    if (text.includes('aadha') || text.includes('adha') || text.includes('half')) {
      quantity = 0.5;
    }
    if (catalogUnitType === 'g') {
      quantity = quantity * 1000;
    }
  }

  return {
    valid: true,
    normalizedQuantity: round(quantity, 3),
    targetUnit: catalogUnitType,
    spokenLabel: rawText,
    category: targetCategory,
  };
}

function detectCategoryFromText(text: string, defaultCategory: UnitCategory): UnitCategory {
  if (text.includes('kilo') || text.includes('kg') || text.includes('gram') || text.includes('gm') || text.includes('paav')) {
    return 'weight';
  }
  if (text.includes('litre') || text.includes('liter') || text.includes('ltr') || text.includes('ml')) {
    return 'liquid';
  }
  if (text.includes('packet') || text.includes('pkt') || text.includes('piece') || text.includes('pc') || text.includes('dibba') || text.includes('darjan')) {
    return 'count';
  }
  return defaultCategory;
}

function extractLeadingNumber(text: string): number | null {
  const digitMatch = text.match(/(\d+(?:\.\d+)?)/);
  if (digitMatch) {
    return parseFloat(digitMatch[1]);
  }
  for (const [word, val] of Object.entries(HINDI_NUMBER_WORDS)) {
    const regex = new RegExp(`\\b${word}\\b`);
    if (regex.test(text)) {
      return val;
    }
  }
  return null;
}

function mismatchResult(
  rawText: string,
  spokenCategory: UnitCategory,
  targetCategory: UnitCategory,
  catalogUnit: CatalogUnitType
): ParseResult {
  return {
    valid: false,
    normalizedQuantity: 0,
    targetUnit: catalogUnit,
    spokenLabel: rawText,
    category: spokenCategory,
    error: 'UNIT_MISMATCH',
    errorMessage: `Unit mismatch: Spoken quantity "${rawText}" is for ${spokenCategory}, but item is sold in ${catalogUnit} (${targetCategory}).`,
  };
}

export function round(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
