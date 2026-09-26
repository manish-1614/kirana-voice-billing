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
import { SEED_CATALOG, CatalogItem, VARIANT_GROUPS, VariantGroup } from './catalog-data';
import { getServerSupabase } from './supabase/server';

export interface ItemVariantSummary {
  id: string;
  canonical_name: string;
  unit_type: CatalogUnitType;
  current_price: number;
  is_default?: boolean;
}

export interface ResolvedItem {
  id: string;
  canonical_name: string;
  unit_type: CatalogUnitType;
  current_price: number;
  matched_alias: string;
  similarity: number;
  is_exact: boolean;
  variant_group_id?: string;
  variant_group_name?: string;
  available_variants?: ItemVariantSummary[];
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
 * Enriches a resolved item with variant group metadata and available alternatives
 */
export function attachVariantInfo(item: ResolvedItem): ResolvedItem {
  if (item.available_variants && item.available_variants.length > 0) {
    return item;
  }

  const catalogItem = SEED_CATALOG.find(
    (ci) => ci.id === item.id || ci.canonical_name.toLowerCase() === item.canonical_name.toLowerCase()
  );
  const groupId = catalogItem?.variant_group_id || item.variant_group_id;
  if (!groupId) return item;

  const group = VARIANT_GROUPS.find((g) => g.id === groupId);
  if (!group) return item;

  const variants: ItemVariantSummary[] = SEED_CATALOG
    .filter((ci) => ci.variant_group_id === groupId)
    .map((ci) => ({
      id: ci.id,
      canonical_name: ci.canonical_name,
      unit_type: ci.unit_type,
      current_price: ci.current_price,
      is_default: ci.id === group.default_item_id,
    }));

  return {
    ...item,
    variant_group_id: group.id,
    variant_group_name: group.group_name,
    available_variants: variants,
  };
}

/**
 * Checks if query matches a variant group alias (e.g. "usna chawal", "namak")
 * and resolves to its configured default variant item.
 */
function matchVariantGroup(query: string): ResolvedItem | null {
  const cleanQuery = query.toLowerCase().trim();
  const normalizedQuery = normalizeHinglish(cleanQuery);

  for (const group of VARIANT_GROUPS) {
    const matched = group.aliases.some((alias) => {
      const cleanAlias = alias.toLowerCase().trim();
      return cleanAlias === cleanQuery || normalizeHinglish(cleanAlias) === normalizedQuery;
    });

    if (matched) {
      const defaultItem = SEED_CATALOG.find((i) => i.id === group.default_item_id);
      if (defaultItem) {
        const variants: ItemVariantSummary[] = SEED_CATALOG
          .filter((ci) => ci.variant_group_id === group.id)
          .map((ci) => ({
            id: ci.id,
            canonical_name: ci.canonical_name,
            unit_type: ci.unit_type,
            current_price: ci.current_price,
            is_default: ci.id === group.default_item_id,
          }));

        return {
          id: defaultItem.id,
          canonical_name: defaultItem.canonical_name,
          unit_type: defaultItem.unit_type,
          current_price: defaultItem.current_price,
          matched_alias: cleanQuery,
          similarity: 1.0,
          is_exact: true,
          variant_group_id: group.id,
          variant_group_name: group.group_name,
          available_variants: variants,
        };
      }
    }
  }

  return null;
}

/**
 * Resolves a spoken item name to a catalog item using the tiered resolution pipeline.
 */
export async function resolveItem(spokenText: string): Promise<ResolveResult> {
  const cleanQuery = spokenText.toLowerCase().trim();
  if (!cleanQuery) {
    return { status: 'not_found', query: spokenText, source: 'in_memory_fallback' };
  }

  const groupMatch = matchVariantGroup(cleanQuery);
  const supabase = getServerSupabase();

  // Path A: If live Supabase connection is available
  if (supabase) {
    try {
      // Check group-level aliases first
      const { data: dbGroupAlias } = await supabase
        .from('variant_group_aliases')
        .select('group_id, variant_groups(id, group_name, default_item_id)')
        .ilike('alias_text', cleanQuery)
        .maybeSingle();

      const vg: any = dbGroupAlias ? (Array.isArray((dbGroupAlias as any).variant_groups) ? (dbGroupAlias as any).variant_groups[0] : (dbGroupAlias as any).variant_groups) : null;

      if (vg?.default_item_id) {
        const { data: defaultItem } = await supabase
          .from('items')
          .select('*')
          .eq('id', vg.default_item_id)
          .maybeSingle();

        if (defaultItem) {
          const { data: allVariants } = await supabase
            .from('items')
            .select('id, canonical_name, unit_type, current_price')
            .eq('variant_group_id', dbGroupAlias!.group_id);

          return {
            status: 'ok',
            item: {
              id: defaultItem.id,
              canonical_name: defaultItem.canonical_name,
              unit_type: defaultItem.unit_type,
              current_price: defaultItem.current_price,
              matched_alias: cleanQuery,
              similarity: 1.0,
              is_exact: true,
              variant_group_id: dbGroupAlias!.group_id,
              variant_group_name: vg.group_name,
              available_variants: (allVariants || []).map((v: any) => ({
                ...v,
                is_default: v.id === defaultItem.id,
              })),
            },
            query: spokenText,
            source: 'database',
          };
        }
      }

      const { data, error } = await supabase.rpc('resolve_item_by_alias', {
        query_text: cleanQuery,
        similarity_threshold: 0.35,
      });

      if (!error && Array.isArray(data) && data.length > 0) {
        const evalRes = evaluateCandidates(data as ResolvedItem[], cleanQuery, 'database');
        if (evalRes.status === 'ok' && evalRes.item) {
          evalRes.item = attachVariantInfo(evalRes.item);
        }
        return evalRes;
      }
    } catch (err) {
      console.warn('[Resolver] Supabase RPC failed, using in-memory fallback:', err);
    }
  }

  // Path B: In-memory Mock Fallback using SEED_CATALOG
  // Exact SKU match takes precedence
  const exactSku = SEED_CATALOG.find((item) =>
    item.aliases.some((a) => a.toLowerCase().trim() === cleanQuery)
  );
  if (exactSku) {
    return {
      status: 'ok',
      item: attachVariantInfo({
        id: exactSku.id,
        canonical_name: exactSku.canonical_name,
        unit_type: exactSku.unit_type,
        current_price: exactSku.current_price,
        matched_alias: cleanQuery,
        similarity: 1.0,
        is_exact: true,
      }),
      query: spokenText,
      source: 'in_memory_fallback',
    };
  }

  // Variant group alias match resolves to configured default variant
  if (groupMatch) {
    return {
      status: 'ok',
      item: groupMatch,
      query: spokenText,
      source: 'in_memory_fallback',
    };
  }

  const mockCandidates = resolveInMemory(cleanQuery);
  const evalRes = evaluateCandidates(mockCandidates, cleanQuery, 'in_memory_fallback');
  if (evalRes.status === 'ok' && evalRes.item) {
    evalRes.item = attachVariantInfo(evalRes.item);
  }
  return evalRes;
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
