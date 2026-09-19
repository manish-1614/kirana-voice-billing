/**
 * Kirana Voice Billing — Tiered Item Resolver
 * 
 * Implements the 3-tier catalog resolver:
 * 1. Tier 1: Exact string match on alias (1.0 confidence)
 * 2. Tier 2: Phonetic normalization (vowel collapsing aa->a, ee->i, oo->u)
 * 3. Tier 3: Trigram similarity with confidence margin check to prevent silent wrong additions.
 * 
 * Seamlessly uses Supabase PostgreSQL pg_trgm when connected, or falls back
 * to the in-memory seed catalog with an identical trigram engine when running locally without keys.
 */

import { CatalogUnitType } from './quantity-parser';
import { SEED_CATALOG, CatalogItem } from './catalog-data';
import { getServerSupabase } from './supabase/server';

export interface ResolvedItem {
  id: string;
  canonical_name: string;
  unit_type: CatalogUnitType;
  current_price: number;
  matched_alias: string;
  similarity: number;
  is_exact: boolean;
}

export interface ResolveResult {
  status: 'ok' | 'ambiguous' | 'not_found';
  item?: ResolvedItem;
  candidates?: ResolvedItem[];
  query: string;
  source: 'database' | 'in_memory_fallback';
}

/**
 * Phonetically normalizes Hinglish variations (e.g. "cheeni" -> "chini", "aata" -> "atta")
 */
export function normalizeHinglish(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/aa/g, 'a')
    .replace(/([a-z])\1+/g, '$1') // Collapse repeated characters: tt -> t, pp -> p, etc.
    .replace(/\s+/g, ' ');
}

/**
 * Generates trigrams for a string padded identically to PostgreSQL pg_trgm
 */
export function getTrigrams(text: string): Set<string> {
  const padded = `  ${text.toLowerCase().trim()} `;
  const trigrams = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i++) {
    trigrams.add(padded.substring(i, i + 3));
  }
  return trigrams;
}

/**
 * Calculates pg_trgm compatible similarity between two strings: |A ∩ B| / |A ∪ B|
 */
export function trigramSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  if (str1.toLowerCase().trim() === str2.toLowerCase().trim()) return 1.0;

  const set1 = getTrigrams(str1);
  const set2 = getTrigrams(str2);

  let intersection = 0;
  for (const tri of set1) {
    if (set2.has(tri)) {
      intersection++;
    }
  }

  const union = set1.size + set2.size - intersection;
  return union === 0 ? 0 : Math.round((intersection / union) * 1000) / 1000;
}

/**
 * Resolves a spoken item name to a catalog item using the tiered resolution pipeline.
 */
export async function resolveItem(spokenText: string): Promise<ResolveResult> {
  const cleanQuery = spokenText.toLowerCase().trim();
  if (!cleanQuery) {
    return { status: 'not_found', query: spokenText, source: 'in_memory_fallback' };
  }

  const supabase = getServerSupabase();

  // Path A: If live Supabase connection is available
  if (supabase) {
    try {
      const { data, error } = await supabase.rpc('resolve_item_by_alias', {
        query_text: cleanQuery,
        similarity_threshold: 0.35,
      });

      if (!error && Array.isArray(data) && data.length > 0) {
        return evaluateCandidates(data as ResolvedItem[], cleanQuery, 'database');
      }
    } catch (err) {
      console.warn('[Resolver] Supabase RPC failed, using in-memory fallback:', err);
    }
  }

  // Path B: In-memory Mock Fallback using SEED_CATALOG
  const mockCandidates = resolveInMemory(cleanQuery);
  return evaluateCandidates(mockCandidates, cleanQuery, 'in_memory_fallback');
}

/**
 * In-memory candidate search simulating Postgres exact + phonetic + pg_trgm logic
 */
function resolveInMemory(query: string): ResolvedItem[] {
  const normalizedQuery = normalizeHinglish(query);
  const candidates: ResolvedItem[] = [];

  for (const item of SEED_CATALOG) {
    for (const alias of item.aliases) {
      const cleanAlias = alias.toLowerCase().trim();
      const normalizedAlias = normalizeHinglish(cleanAlias);

      // Tier 1: Exact match
      if (cleanAlias === query) {
        return [{
          id: item.id,
          canonical_name: item.canonical_name,
          unit_type: item.unit_type,
          current_price: item.current_price,
          matched_alias: alias,
          similarity: 1.0,
          is_exact: true,
        }];
      }

      // Tier 2: Phonetic normalization match
      let similarity = 0;
      let isExact = false;
      if (normalizedAlias === normalizedQuery) {
        similarity = 0.95;
        isExact = false;
      } else {
        // Tier 3: Trigram similarity + word-level token match (e.g. "dal" in "toor dal")
        const triSim = trigramSimilarity(alias, query);
        const words = cleanAlias.split(/\s+/);
        const isWordMatch = words.includes(query) || words.some(w => normalizeHinglish(w) === normalizedQuery);
        similarity = isWordMatch ? Math.max(triSim, 0.52) : triSim;
      }

      if (similarity >= 0.35) {
        candidates.push({
          id: item.id,
          canonical_name: item.canonical_name,
          unit_type: item.unit_type,
          current_price: item.current_price,
          matched_alias: alias,
          similarity,
          is_exact: isExact,
        });
      }
    }
  }

  // Deduplicate by item id, keeping the highest similarity alias per item
  const itemMap = new Map<string, ResolvedItem>();
  for (const cand of candidates) {
    const existing = itemMap.get(cand.id);
    if (!existing || cand.similarity > existing.similarity) {
      itemMap.set(cand.id, cand);
    }
  }

  return Array.from(itemMap.values()).sort((a, b) => b.similarity - a.similarity);
}

/**
 * Applies confidence margins to decide whether a match is OK, AMBIGUOUS, or NOT_FOUND
 */
function evaluateCandidates(
  candidates: ResolvedItem[],
  query: string,
  source: 'database' | 'in_memory_fallback'
): ResolveResult {
  if (candidates.length === 0) {
    return { status: 'not_found', query, source };
  }

  const top1 = candidates[0];

  // Exact match always succeeds immediately
  if (top1.similarity === 1.0 || top1.is_exact) {
    return { status: 'ok', item: top1, query, source };
  }

  // High confidence threshold (>= 0.65)
  if (top1.similarity >= 0.65) {
    if (candidates.length > 1) {
      const top2 = candidates[1];
      // If two distinct items have almost identical high similarity (<0.08 margin)
      if (top1.similarity - top2.similarity < 0.08) {
        return {
          status: 'ambiguous',
          candidates: candidates.slice(0, 3),
          query,
          source,
        };
      }
    }
    return { status: 'ok', item: top1, query, source };
  }

  // Moderate confidence threshold (0.45 to 0.64)
  if (top1.similarity >= 0.45) {
    if (candidates.length > 1) {
      const top2 = candidates[1];
      // Ambiguity margin check: if top2 is within 0.15 of top1
      if (top1.similarity - top2.similarity < 0.15) {
        return {
          status: 'ambiguous',
          candidates: candidates.slice(0, 3),
          query,
          source,
        };
      }
    }
    return { status: 'ok', item: top1, query, source };
  }

  // Weak match (< 0.45) -> Treat as not found to avoid silent wrong items
  return { status: 'not_found', query, source };
}
