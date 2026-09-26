/**
 * Unit tests for Deterministic Colloquial Quantity Parser
 */

import { parseSpokenQuantity } from './quantity-parser';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`FAIL: ${msg}`);
  }
}

export function runParserTests() {
  console.log('--- Running Quantity Parser Test Suite ---');

  // 1. Paav phrases (kg basis)
  let r = parseSpokenQuantity('1 paav', 'kg');
  assert(r.valid && r.normalizedQuantity === 0.25, '1 paav -> 0.25 kg');

  r = parseSpokenQuantity('paav', 'kg');
  assert(r.valid && r.normalizedQuantity === 0.25, 'paav -> 0.25 kg');

  r = parseSpokenQuantity('2 paav', 'kg');
  assert(r.valid && r.normalizedQuantity === 0.5, '2 paav -> 0.5 kg');

  r = parseSpokenQuantity('3 paav', 'kg');
  assert(r.valid && r.normalizedQuantity === 0.75, '3 paav -> 0.75 kg');

  r = parseSpokenQuantity('aadha paav', 'kg');
  assert(r.valid && r.normalizedQuantity === 0.125, 'aadha paav -> 0.125 kg');

  // 2. Colloquial fractions
  r = parseSpokenQuantity('paun kilo', 'kg');
  assert(r.valid && r.normalizedQuantity === 0.75, 'paun kilo -> 0.75 kg');

  r = parseSpokenQuantity('aadha kilo', 'kg');
  assert(r.valid && r.normalizedQuantity === 0.5, 'aadha kilo -> 0.5 kg');

  r = parseSpokenQuantity('sawa kilo', 'kg');
  assert(r.valid && r.normalizedQuantity === 1.25, 'sawa kilo -> 1.25 kg');

  r = parseSpokenQuantity('dedh kilo', 'kg');
  assert(r.valid && r.normalizedQuantity === 1.5, 'dedh kilo -> 1.5 kg');

  r = parseSpokenQuantity('paune do kilo', 'kg');
  assert(r.valid && r.normalizedQuantity === 1.75, 'paune do kilo -> 1.75 kg');

  r = parseSpokenQuantity('dhai kilo', 'kg');
  assert(r.valid && r.normalizedQuantity === 2.5, 'dhai kilo -> 2.5 kg');

  r = parseSpokenQuantity('sadhe teen kilo', 'kg');
  assert(r.valid && r.normalizedQuantity === 3.5, 'sadhe teen kilo -> 3.5 kg');

  // 3. Spoken Grams
  r = parseSpokenQuantity('sau gram', 'kg');
  assert(r.valid && r.normalizedQuantity === 0.1, 'sau gram -> 0.1 kg');

  r = parseSpokenQuantity('dedh sau gram', 'kg');
  assert(r.valid && r.normalizedQuantity === 0.15, 'dedh sau gram -> 0.15 kg');

  r = parseSpokenQuantity('dhai-sau gram', 'kg');
  assert(r.valid && r.normalizedQuantity === 0.25, 'dhai-sau gram -> 0.25 kg');

  r = parseSpokenQuantity('500 gm', 'kg');
  assert(r.valid && r.normalizedQuantity === 0.5, '500 gm -> 0.5 kg');

  // 4. Dozens & Counts
  r = parseSpokenQuantity('ek darjan', 'piece');
  assert(r.valid && r.normalizedQuantity === 12, 'ek darjan -> 12 piece');

  r = parseSpokenQuantity('aadha darjan', 'piece');
  assert(r.valid && r.normalizedQuantity === 6, 'aadha darjan -> 6 piece');

  r = parseSpokenQuantity('2 packet', 'packet');
  assert(r.valid && r.normalizedQuantity === 2, '2 packet -> 2 packet');

  r = parseSpokenQuantity('paanch packet', 'packet');
  assert(r.valid && r.normalizedQuantity === 5, 'paanch packet -> 5 packet');

  // 5. Liquids
  r = parseSpokenQuantity('1 litre', 'litre');
  assert(r.valid && r.normalizedQuantity === 1.0, '1 litre -> 1.0 litre');

  r = parseSpokenQuantity('aadha litre', 'litre');
  assert(r.valid && r.normalizedQuantity === 0.5, 'aadha litre -> 0.5 litre');

  r = parseSpokenQuantity('500 ml', 'litre');
  assert(r.valid && r.normalizedQuantity === 0.5, '500 ml -> 0.5 litre');

  // 6. Unit Mismatch Rejection
  r = parseSpokenQuantity('aadha kilo', 'packet');
  assert(!r.valid && r.error === 'UNIT_MISMATCH', 'aadha kilo on packet item should reject');

  r = parseSpokenQuantity('2 litre', 'kg');
  assert(!r.valid && r.error === 'UNIT_MISMATCH', '2 litre on kg item should reject');

  r = parseSpokenQuantity('1 paav', 'packet');
  assert(!r.valid && r.error === 'UNIT_MISMATCH', '1 paav on packet item should reject');

  // 7. Alternate regional spellings (adha = aadha)
  r = parseSpokenQuantity('adha kilo', 'kg');
  assert(r.valid && r.normalizedQuantity === 0.5, 'adha kilo -> 0.5 kg');

  r = parseSpokenQuantity('adha darjan', 'piece');
  assert(r.valid && r.normalizedQuantity === 6, 'adha darjan -> 6 piece');

  console.log('✅ All 26 Quantity Parser Tests Passed Successfully!');
}

// Auto-run if executed via ts-node or node
if (typeof require !== 'undefined' && require.main === module) {
  runParserTests();
}
