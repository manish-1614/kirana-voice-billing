/**
 * Unit tests for Tiered Item Resolver
 */

import { resolveItem, trigramSimilarity, normalizeHinglish } from './item-resolver';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`FAIL: ${msg}`);
  }
}

export async function runResolverTests() {
  console.log('--- Running Item Resolver Test Suite ---');

  // 1. Trigram Engine Validation
  const sim1 = trigramSimilarity('chini', 'chini');
  assert(sim1 === 1.0, 'Identical strings must have similarity 1.0');

  const sim2 = trigramSimilarity('aashirvaad', 'aashirvad');
  assert(sim2 > 0.5, 'aashirvaad vs aashirvad similarity must be above 0.5');

  // 2. Phonetic Normalization (Handling short Hinglish double-letter quirks)
  const norm1 = normalizeHinglish('Cheeni');
  assert(norm1 === 'chini', 'Cheeni must normalize to chini');

  const norm2 = normalizeHinglish('atta');
  const norm3 = normalizeHinglish('aata');
  assert(norm2 === norm3 && norm2 === 'ata', 'atta and aata must both phonetically normalize to ata');

  // 3. Exact Match
  let r = await resolveItem('chini');
  assert(r.status === 'ok' && r.item?.canonical_name === 'Sugar (Chini)', 'Exact "chini" -> Sugar');

  r = await resolveItem('sarso tel');
  assert(r.status === 'ok' && r.item?.canonical_name === 'Mustard Oil (Kachhi Ghani)', 'Exact "sarso tel" -> Mustard Oil');

  // 4. Phonetic & Fuzzy Variation
  r = await resolveItem('cheeni');
  assert(r.status === 'ok' && r.item?.canonical_name === 'Sugar (Chini)', 'Phonetic "cheeni" -> Sugar');

  r = await resolveItem('aashirvad aata');
  assert(r.status === 'ok' && r.item?.canonical_name === 'Aashirvaad Atta', 'Fuzzy "aashirvad aata" -> Aashirvaad Atta');

  // 5. Ambiguity Margin Check (e.g. generic "dal" matches multiple dals closely)
  r = await resolveItem('dal');
  assert(
    r.status === 'ambiguous' && (r.candidates?.length ?? 0) >= 2,
    'Generic "dal" must be flagged as ambiguous with multiple candidates'
  );
  console.log('   Ambiguity candidates for "dal":', r.candidates?.map(c => `${c.canonical_name} (${c.similarity})`).join(', '));

  // 6. Unknown SKU
  r = await resolveItem('pizza cheese burst');
  assert(r.status === 'not_found', 'Unknown item must return not_found');

  // 7. Variant Group Default Resolution: "usna chawal" -> default "Usna Chawal (Baba)"
  r = await resolveItem('usna chawal');
  assert(r.status === 'ok', 'Group alias "usna chawal" must resolve to ok');
  assert(r.item?.canonical_name === 'Usna Chawal (Baba)', `Expected default "Usna Chawal (Baba)", got ${r.item?.canonical_name}`);
  assert(r.item?.available_variants?.length === 5, `Expected 5 Usna variants, got ${r.item?.available_variants?.length}`);
  console.log('✅ Passed: Group alias "usna chawal" resolved to default variant (Baba) with 5 alternatives.');

  // 8. Variant Group Default Resolution: "namak" -> default "Tata Salt 1kg"
  r = await resolveItem('namak');
  assert(r.status === 'ok', 'Group alias "namak" must resolve to ok');
  assert(r.item?.canonical_name === 'Tata Salt 1kg', `Expected default "Tata Salt 1kg", got ${r.item?.canonical_name}`);
  assert(r.item?.available_variants?.length === 2, `Expected 2 Salt variants, got ${r.item?.available_variants?.length}`);
  console.log('✅ Passed: Group alias "namak" resolved to default variant (Tata Salt 1kg) with alternatives.');

  // 9. Exact SKU Resolution for a variant: "baskathi" -> "Usna Chawal (Baskathi)"
  r = await resolveItem('baskathi');
  assert(r.status === 'ok', 'Specific SKU alias "baskathi" must resolve to ok');
  assert(r.item?.canonical_name === 'Usna Chawal (Baskathi)', `Expected "Usna Chawal (Baskathi)", got ${r.item?.canonical_name}`);
  assert(r.item?.current_price === 42, `Expected Rs 42, got ${r.item?.current_price}`);
  assert(r.item?.available_variants?.length === 5, `Expected 5 Usna variants on SKU item, got ${r.item?.available_variants?.length}`);
  console.log('✅ Passed: Specific variant "baskathi" resolved to Baskathi SKU with alternatives.');

  console.log('✅ All Item Resolver Tests Passed Successfully!');
}

if (typeof require !== 'undefined' && require.main === module) {
  runResolverTests().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
