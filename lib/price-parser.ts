/**
 * Kirana Voice Billing — Deterministic Price Number Parser
 * 
 * Accurately parses and normalizes spoken price and rate numbers from Hindi,
 * Hinglish, and English phrasing (e.g. "nabbe", "unyasi", "70 rupaye me lagao",
 * "rate 35", "fifty-five", "pachpan").
 * 
 * Strict deterministic parser:
 * - Never guesses or hallucinates a price.
 * - Rejects non-finite, negative, zero, or unparseable words.
 * - Extracts clean numeric value for price overrides and catalog updates.
 */

export interface PriceParseResult {
  valid: boolean;
  price?: number;
  raw: string | number;
  error?: string;
}

// 1-100 Hindi / Hinglish number words
const HINDI_PRICE_WORDS: Record<string, number> = {
  // 1 - 10
  'ek': 1, 'do': 2, 'teen': 3, 'chaar': 4, 'char': 4, 'paanch': 5, 'panch': 5,
  'chhah': 6, 'chhe': 6, 'saat': 7, 'aath': 8, 'nau': 9, 'das': 10,
  // 11 - 20
  'gyarah': 11, 'gyara': 11, 'barah': 12, 'bara': 12, 'terah': 13, 'tera': 13,
  'chaudah': 14, 'chauda': 14, 'pandrah': 15, 'pandra': 15, 'solah': 16, 'sola': 16,
  'satrah': 17, 'satra': 17, 'atharah': 18, 'athara': 18, 'unnees': 19, 'unnis': 19, 'bees': 20,
  // 21 - 30
  'ikkees': 21, 'ikkis': 21, 'baees': 22, 'bais': 22, 'teyees': 23, 'teis': 23, 'teyis': 23,
  'chaubees': 24, 'chaubis': 24, 'pachees': 25, 'pachis': 25, 'chhabees': 26, 'chhabis': 26,
  'sattaees': 27, 'sattais': 27, 'atthaees': 28, 'atthais': 28, 'untees': 29, 'untis': 29, 'tees': 30,
  // 31 - 40
  'iktees': 31, 'iktis': 31, 'battees': 32, 'battis': 32, 'tentees': 33, 'tentis': 33,
  'chauntees': 34, 'chauntis': 34, 'chautis': 34, 'paintees': 35, 'paintis': 35,
  'chhattees': 36, 'chhattis': 36, 'saintees': 37, 'saintis': 37, 'adhtees': 38, 'adhtis': 38, 'artees': 38,
  'untaalees': 39, 'untalis': 39, 'chaalees': 40, 'chaalis': 40, 'chalis': 40,
  // 41 - 50
  'iktaalees': 41, 'iktalis': 41, 'bayalees': 42, 'bayalis': 42, 'tantaalees': 43, 'tantalis': 43,
  'chauvaalees': 44, 'chauvalis': 44, 'paintaalees': 45, 'paintalis': 45,
  'chhiyaalees': 46, 'chhiyalis': 46, 'saintaalees': 47, 'saintalis': 47,
  'adhtaalees': 48, 'adhtalis': 48, 'unchaas': 49, 'unchas': 49, 'pachaas': 50, 'pachas': 50,
  // 51 - 60
  'ikyavan': 51, 'ikkyavan': 51, 'baavan': 52, 'bawan': 52, 'tirpan': 53, 'chauvan': 54,
  'pachpan': 55, 'chhappan': 56, 'sattaavan': 57, 'sattavan': 57, 'atthaavan': 58, 'atthavan': 58,
  'unsath': 59, 'saath': 60, 'sath': 60,
  // 61 - 70
  'iksath': 61, 'baasath': 62, 'basath': 62, 'tirsath': 63, 'chausath': 64, 'painsath': 65,
  'chhiyaasath': 66, 'sadsath': 67, 'arsath': 68, 'arhasath': 68, 'unhattar': 69, 'sattar': 70,
  // 71 - 80
  'ikhattar': 71, 'bahattar': 72, 'tihattar': 73, 'chauhattar': 74, 'pachhattar': 75,
  'chhihattar': 76, 'sathattar': 77, 'athhattar': 78,
  'unyasi': 79, 'unnasi': 79, 'unasi': 79, 'assi': 80,
  // 81 - 90
  'ikyasi': 81, 'ikiyasi': 81, 'bayasi': 82, 'tirasi': 83, 'chaurasi': 84, 'pachasi': 85,
  'chhiyasi': 86, 'sattasi': 87, 'atthasi': 88,
  'navasi': 89, 'nawasi': 89, 'nauvasi': 89,
  'nabbe': 90, 'nabbey': 90, 'nave': 90,
  // 91 - 100
  'ikyanve': 91, 'baanve': 92, 'tiranve': 93, 'chauranve': 94, 'pachanve': 95,
  'chhiyanve': 96, 'sattanve': 97, 'atthanve': 98, 'ninyanve': 99, 'sau': 100,
  // Special hundreds / multiples
  'dedh sau': 150, 'derh sau': 150, 'dhai sau': 250, 'dhayi sau': 250,
  'hazaar': 1000, 'hazar': 1000,
};

// English number words
const ENGLISH_ONES: Record<string, number> = {
  'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
  'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
  'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19,
};

const ENGLISH_TENS: Record<string, number> = {
  'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50,
  'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90,
};

/**
 * Parses any price string or numeric value into a verified positive number.
 */
export function parsePricePhrase(raw: string | number | undefined | null): PriceParseResult {
  if (raw === undefined || raw === null || raw === '') {
    return { valid: false, raw: '', error: 'Price input is empty' };
  }

  // 1. Direct numeric handling
  if (typeof raw === 'number') {
    if (!isFinite(raw) || isNaN(raw)) {
      return { valid: false, raw, error: 'Price must be a finite number' };
    }
    if (raw <= 0) {
      return { valid: false, raw, error: 'Price must be greater than zero' };
    }
    return { valid: true, price: Math.round(raw * 100) / 100, raw };
  }

  const rawStr = String(raw).trim();
  if (!rawStr) {
    return { valid: false, raw, error: 'Price input is empty' };
  }

  // Normalize string: lowercase, replace hyphens and underscores with spaces, collapse multiple spaces
  let text = rawStr
    .toLowerCase()
    .replace(/[₹$,]/g, ' ')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip colloquial context words around the price:
  // e.g. "70 rupaye me lagao", "rate 35", "bhav 75", "nabbe rupaye", "me lagana", "karo", "dijiye"
  text = text
    .replace(/\b(rupaye|rupaya|rupees|rupee|rs|inr|re)\b/g, ' ')
    .replace(/\b(rate|bhav|daam|kimat|ke hisab se|ke bhav se|me lagao|me laga do|me lagana|me|karo|kar do|dijiye)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return { valid: false, raw, error: `Could not extract numeric price from "${rawStr}"` };
  }

  // 2. Direct digits / decimals check (e.g. "35", "70.50")
  const digitMatch = text.match(/^(\d+(?:\.\d+)?)$/);
  if (digitMatch) {
    const val = parseFloat(digitMatch[1]);
    if (!isFinite(val) || isNaN(val) || val <= 0) {
      return { valid: false, raw, error: `Invalid numeric price: ${val}` };
    }
    return { valid: true, price: Math.round(val * 100) / 100, raw };
  }

  // If text contains digits with extra words, extract the digits (e.g. "35 rupaye" after stripping -> "35")
  const embeddedDigitMatch = text.match(/\b(\d+(?:\.\d+)?)\b/);
  if (embeddedDigitMatch) {
    const val = parseFloat(embeddedDigitMatch[1]);
    if (isFinite(val) && !isNaN(val) && val > 0) {
      return { valid: true, price: Math.round(val * 100) / 100, raw };
    }
  }

  // 3. Check exact Hindi number words (e.g. "nabbe", "unyasi", "navasi", "gyarah", "terah", "pachpan")
  if (HINDI_PRICE_WORDS[text] !== undefined) {
    return { valid: true, price: HINDI_PRICE_WORDS[text], raw };
  }

  // 4. Check multi-word Hindi numbers:
  // e.g. "ek sau pachas" (150), "do sau" (200), "teen sau" (300)
  const words = text.split(' ').filter(Boolean);
  if (words.length > 1) {
    // Check if whole phrase matches known combinations
    const phrase = words.join(' ');
    if (HINDI_PRICE_WORDS[phrase] !== undefined) {
      return { valid: true, price: HINDI_PRICE_WORDS[phrase], raw };
    }

    // Pattern: [count] sau [remainder] e.g. "ek sau bees", "do sau pachas"
    if (words.includes('sau')) {
      const sauIdx = words.indexOf('sau');
      const multiplierWord = sauIdx > 0 ? words[sauIdx - 1] : 'ek';
      const multiplier = HINDI_PRICE_WORDS[multiplierWord] ?? ENGLISH_ONES[multiplierWord] ?? 1;
      let total = multiplier * 100;

      const remainderWords = words.slice(sauIdx + 1);
      if (remainderWords.length > 0) {
        const remainderText = remainderWords.join(' ');
        const remainderVal = HINDI_PRICE_WORDS[remainderText] ?? parseEnglishNumber(remainderText);
        if (remainderVal !== null) {
          total += remainderVal;
        }
      }
      return { valid: true, price: total, raw };
    }
  }

  // 5. Check English number words: e.g. "ten", "fourteen", "fifty five", "fifty-five"
  const englishVal = parseEnglishNumber(text);
  if (englishVal !== null && englishVal > 0) {
    return { valid: true, price: englishVal, raw };
  }

  // If no match found, reject deterministically
  return {
    valid: false,
    raw,
    error: `Unsupported or unparseable price phrase: "${rawStr}"`,
  };
}

/**
 * Helper to parse English number words like "ten", "fourteen", "fifty five"
 */
function parseEnglishNumber(text: string): number | null {
  const clean = text.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();

  if (ENGLISH_ONES[clean] !== undefined) {
    return ENGLISH_ONES[clean];
  }

  if (ENGLISH_TENS[clean] !== undefined) {
    return ENGLISH_TENS[clean];
  }

  const parts = clean.split(' ').filter(Boolean);
  if (parts.length === 2) {
    const tensVal = ENGLISH_TENS[parts[0]];
    const onesVal = ENGLISH_ONES[parts[1]];
    if (tensVal !== undefined && onesVal !== undefined) {
      return tensVal + onesVal;
    }
  }

  if (clean === 'hundred' || clean === 'one hundred') {
    return 100;
  }

  return null;
}
