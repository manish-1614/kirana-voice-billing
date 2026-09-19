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

  console.log('✅ All Item Resolver Tests Passed Successfully!');
}

if (typeof require !== 'undefined' && require.main === module) {
  runResolverTests().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
