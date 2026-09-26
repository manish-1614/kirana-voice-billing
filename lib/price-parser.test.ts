/**
 * Unit Tests for Deterministic Price Parser
 */

import { parsePricePhrase } from './price-parser';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`FAIL: ${msg}`);
  }
}

export function runPriceParserTests() {
  console.log('\n--- Running Price Parser Test Suite ---');

  // 1. Mandatory Hindi / Hinglish number words
  const hindiCases = [
    { input: 'nabbe', expected: 90 },
    { input: 'unyasi', expected: 79 },
    { input: 'navasi', expected: 89 },
    { input: 'gyarah', expected: 11 },
    { input: 'terah', expected: 13 },
    { input: 'pachpan', expected: 55 },
    { input: 'pachees', expected: 25 },
    { input: 'chaalis', expected: 40 },
    { input: 'pachaas', expected: 50 },
    { input: 'sattar', expected: 70 },
  ];

  for (const c of hindiCases) {
    const res = parsePricePhrase(c.input);
    assert(res.valid === true, `Expected "${c.input}" to be valid`);
    assert(res.price === c.expected, `Expected "${c.input}" to parse as ${c.expected}, got ${res.price}`);
  }
  console.log('✅ Passed: Required Hindi price words (nabbe, unyasi, navasi, gyarah, terah, pachpan).');

  // 2. Mandatory English number words
  const englishCases = [
    { input: 'ten', expected: 10 },
    { input: 'fourteen', expected: 14 },
    { input: 'fifty-five', expected: 55 },
    { input: 'fifty five', expected: 55 },
    { input: 'thirty-five', expected: 35 },
    { input: 'seventy', expected: 70 },
  ];

  for (const c of englishCases) {
    const res = parsePricePhrase(c.input);
    assert(res.valid === true, `Expected "${c.input}" to be valid`);
    assert(res.price === c.expected, `Expected "${c.input}" to parse as ${c.expected}, got ${res.price}`);
  }
  console.log('✅ Passed: Required English price words (ten, fourteen, fifty-five).');

  // 3. Mixed Hinglish contextual phrasing around price
  const mixedPhrases = [
    { input: '70 rupaye me lagao', expected: 70 },
    { input: 'rate 35', expected: 35 },
    { input: 'rate unyasi', expected: 79 },
    { input: 'nabbe rupaye', expected: 90 },
    { input: 'pachpan rate karo', expected: 55 },
    { input: 'bhav 44', expected: 44 },
    { input: '₹75', expected: 75 },
    { input: '75.50', expected: 75.50 },
    { input: 'ek sau pachas', expected: 150 },
    { input: 'dhai sau', expected: 250 },
  ];

  for (const c of mixedPhrases) {
    const res = parsePricePhrase(c.input);
    assert(res.valid === true, `Expected phrase "${c.input}" to be valid`);
    assert(res.price === c.expected, `Expected phrase "${c.input}" to parse as ${c.expected}, got ${res.price}`);
  }
  console.log('✅ Passed: Mixed Hinglish phrases (e.g. "70 rupaye me lagao", "rate 35", "nabbe rupaye").');

  // 4. Raw numeric passthrough
  assert(parsePricePhrase(35).price === 35, 'Numeric 35 should pass through');
  assert(parsePricePhrase(70.25).price === 70.25, 'Numeric 70.25 should pass through');
  console.log('✅ Passed: Numeric passthrough.');

  // 5. Safe rejection of invalid, negative, zero, and unsupported inputs
  const invalidCases = ['', '   ', 'kuch bhi', -10, 0, 'free', 'sasta karo', NaN, undefined, null];
  for (const inv of invalidCases) {
    const res = parsePricePhrase(inv as any);
    assert(res.valid === false, `Expected input ${JSON.stringify(inv)} to be rejected`);
  }
  console.log('✅ Passed: Invalid and unsupported price inputs safely rejected without guessing.');

  console.log('\n🎉 ALL PRICE PARSER TESTS PASSED SUCCESSFULLY!\n');
}

if (require.main === module) {
  runPriceParserTests();
}
