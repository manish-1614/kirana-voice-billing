/**
 * Kirana Voice Billing — Seed Catalog Data
 * 
 * ~25 authentic Ranchi grocery essentials with current market rates and common Hinglish aliases.
 * Used for database seeding and the in-memory resolver mock fallback.
 */

import { CatalogUnitType } from './quantity-parser';

export interface VariantGroup {
  id: string;
  group_name: string;
  default_item_id: string;
  aliases: string[];
}

export interface CatalogItem {
  id: string;
  canonical_name: string;
  unit_type: CatalogUnitType;
  current_price: number;
  category: string;
  aliases: string[];
  variant_group_id?: string;
}

export const SEED_CATALOG: CatalogItem[] = [
  {
    id: 'item-001',
    canonical_name: 'Sugar (Chini)',
    unit_type: 'kg',
    current_price: 44.0,
    category: 'Staples',
    aliases: ['chini', 'cheeni', 'sugar', 'sakkar', 'shakar'],
  },
  {
    id: 'item-002',
    canonical_name: 'Aashirvaad Atta',
    unit_type: 'kg',
    current_price: 38.0,
    category: 'Staples',
    aliases: ['atta', 'aata', 'aashirvaad atta', 'gehu ka aata', 'chakki atta'],
  },
  {
    id: 'item-003',
    canonical_name: 'Mustard Oil (Kachhi Ghani)',
    unit_type: 'litre',
    current_price: 145.0,
    category: 'Oils',
    aliases: ['sarson tel', 'mustard oil', 'sarso tel', 'kachhi ghani', 'kadwa tel'],
  },
  {
    id: 'item-004',
    canonical_name: 'Fortune Refined Oil',
    unit_type: 'litre',
    current_price: 130.0,
    category: 'Oils',
    aliases: ['refined oil', 'fortune tel', 'refined', 'white tel'],
  },
  {
    id: 'item-005',
    canonical_name: 'Toor Dal (Arhar)',
    unit_type: 'kg',
    current_price: 160.0,
    category: 'Dals',
    aliases: ['toor dal', 'arhar dal', 'rahar dal', 'peeli dal', 'arhar'],
  },
  {
    id: 'item-006',
    canonical_name: 'Chana Dal',
    unit_type: 'kg',
    current_price: 88.0,
    category: 'Dals',
    aliases: ['chana dal', 'chane ki dal', 'chana'],
  },
  {
    id: 'item-007',
    canonical_name: 'Moong Dal Dhuli',
    unit_type: 'kg',
    current_price: 120.0,
    category: 'Dals',
    aliases: ['moong dal', 'mung dal', 'dhuli moong', 'peeli moong'],
  },
  {
    id: 'item-008',
    canonical_name: 'Masoor Dal',
    unit_type: 'kg',
    current_price: 95.0,
    category: 'Dals',
    aliases: ['masoor dal', 'masur dal', 'lal dal'],
  },
  {
    id: 'item-009',
    canonical_name: 'Tata Tea Premium',
    unit_type: 'packet',
    current_price: 140.0,
    category: 'Beverages',
    aliases: ['tata tea', 'tata chai', 'chai patti', 'tata premium'],
  },
  {
    id: 'item-010',
    canonical_name: 'Taaza Tea 250g',
    unit_type: 'packet',
    current_price: 70.0,
    category: 'Beverages',
    aliases: ['taaza', 'taaza chai', 'taza tea', 'taza chai'],
  },
  {
    id: 'item-011',
    canonical_name: 'Tata Salt 1kg',
    unit_type: 'packet',
    current_price: 28.0,
    category: 'Staples',
    variant_group_id: 'vg-namak',
    aliases: ['tata salt', 'tata namak'],
  },
  {
    id: 'item-012',
    canonical_name: 'Maggi Noodles',
    unit_type: 'packet',
    current_price: 14.0,
    category: 'Packaged Goods',
    aliases: ['maggi', 'maggie', 'noodles', '2 minute maggi'],
  },
  {
    id: 'item-013',
    canonical_name: 'Besan',
    unit_type: 'kg',
    current_price: 90.0,
    category: 'Staples',
    aliases: ['besan', 'chana besan'],
  },
  {
    id: 'item-014',
    canonical_name: 'Maida',
    unit_type: 'kg',
    current_price: 40.0,
    category: 'Staples',
    aliases: ['maida', 'refined flour'],
  },
  {
    id: 'item-015',
    canonical_name: 'Suji (Rawa)',
    unit_type: 'kg',
    current_price: 42.0,
    category: 'Staples',
    aliases: ['suji', 'sooji', 'rawa'],
  },
  {
    id: 'item-016',
    canonical_name: 'Basmati Rice Everyday',
    unit_type: 'kg',
    current_price: 75.0,
    category: 'Rice',
    aliases: ['basmati chawal', 'everyday rice', 'basmati', 'chawal'],
  },
  {
    id: 'item-017',
    canonical_name: 'Usna Chawal (Baba)',
    unit_type: 'kg',
    current_price: 36.0,
    category: 'Rice',
    variant_group_id: 'vg-usna',
    aliases: ['baba chawal', 'baba usna', 'mansuri chawal', 'baba'],
  },
  {
    id: 'item-018',
    canonical_name: 'Haldi Powder 100g',
    unit_type: 'packet',
    current_price: 32.0,
    category: 'Spices',
    aliases: ['haldi', 'haldi powder', 'turmeric', 'pisa haldi'],
  },
  {
    id: 'item-019',
    canonical_name: 'Mirchi Powder 100g',
    unit_type: 'packet',
    current_price: 45.0,
    category: 'Spices',
    aliases: ['mircha powder', 'lal mirch', 'chilli powder', 'mirchi powder', 'mirchi'],
  },
  {
    id: 'item-020',
    canonical_name: 'Dhaniya Powder 100g',
    unit_type: 'packet',
    current_price: 35.0,
    category: 'Spices',
    aliases: ['dhaniya powder', 'dhaniya', 'pisa dhaniya'],
  },
  {
    id: 'item-021',
    canonical_name: 'Jeera (Cumin Seeds)',
    unit_type: 'kg',
    current_price: 380.0,
    category: 'Spices',
    aliases: ['jeera', 'jira', 'cumin', 'sabut jeera'],
  },
  {
    id: 'item-022',
    canonical_name: 'Dettol Soap',
    unit_type: 'piece',
    current_price: 38.0,
    category: 'Personal Care',
    aliases: ['dettol sabun', 'dettol soap', 'dettol', 'nahane ka sabun'],
  },
  {
    id: 'item-023',
    canonical_name: 'Vim Bar 125g',
    unit_type: 'piece',
    current_price: 15.0,
    category: 'Cleaning',
    aliases: ['vim bar', 'bartan sabun', 'vim sabun', 'vim'],
  },
  {
    id: 'item-024',
    canonical_name: 'Surf Excel 500g',
    unit_type: 'packet',
    current_price: 85.0,
    category: 'Cleaning',
    aliases: ['surf excel', 'surf', 'detergent powder', 'excel surf'],
  },
  {
    id: 'item-025',
    canonical_name: 'Parle-G Biscuit',
    unit_type: 'packet',
    current_price: 10.0,
    category: 'Snacks',
    aliases: ['parle g', 'parle ji', 'biscuit', 'parle biscuit'],
  },
  {
    id: 'item-026',
    canonical_name: 'Khula Namak (Loose Salt)',
    unit_type: 'kg',
    current_price: 15.0,
    category: 'Staples',
    variant_group_id: 'vg-namak',
    aliases: ['khula namak', 'loose namak', 'local namak', 'loose salt'],
  },
  {
    id: 'item-027',
    canonical_name: 'Usna Chawal (Baskathi)',
    unit_type: 'kg',
    current_price: 42.0,
    category: 'Rice',
    variant_group_id: 'vg-usna',
    aliases: ['baskathi', 'baskati', 'baskathi usna', 'baskathi chawal'],
  },
  {
    id: 'item-028',
    canonical_name: 'Usna Chawal (Minikit)',
    unit_type: 'kg',
    current_price: 38.0,
    category: 'Rice',
    variant_group_id: 'vg-usna',
    aliases: ['minikit', 'minikit usna', 'minikit chawal'],
  },
  {
    id: 'item-029',
    canonical_name: 'Usna Chawal (Rashan)',
    unit_type: 'kg',
    current_price: 28.0,
    category: 'Rice',
    variant_group_id: 'vg-usna',
    aliases: ['rashan chawal', 'ration chawal', 'sarkari chawal'],
  },
  {
    id: 'item-030',
    canonical_name: 'Usna Chawal (Jeerakathi)',
    unit_type: 'kg',
    current_price: 48.0,
    category: 'Rice',
    variant_group_id: 'vg-usna',
    aliases: ['jeerakathi', 'jeera kathi'],
  },
];

export const VARIANT_GROUPS: VariantGroup[] = [
  {
    id: 'vg-usna',
    group_name: 'Usna Chawal',
    default_item_id: 'item-017', // Usna Chawal (Baba)
    aliases: ['usna chawal', 'usna', 'mota chawal', 'bhaat chawal'],
  },
  {
    id: 'vg-namak',
    group_name: 'Namak',
    default_item_id: 'item-011', // Tata Salt 1kg
    aliases: ['namak', 'salt', 'sada namak'],
  },
];

