import { describe, expect, it } from 'vitest'
import { cardNumberFromName, seoCardToListRow, seoSetToItem, sortSetRows, queryWords } from '../src/lib/sets.js'
import type { CatalogListRow } from '../src/lib/prices.js'

const row = (name: string, raw: number | null, number: string | null = null): CatalogListRow =>
  ({ id: name, name, game: 'baseball', expansion_name: 'Baseball Cards 1959 Topps', number, image_small: null, raw_market: raw, psa10_market: null })

describe('cardNumberFromName', () => {
  it('reads the checklist number a sports card carries in its name', () => {
    expect(cardNumberFromName('Mickey Mantle #10')).toBe('10')
    expect(cardNumberFromName('Roger Maris [Gray Back] #202')).toBe('202')
    expect(cardNumberFromName('Willie Mays [Baseball Thrills - Mays Catch Makes Series History] #464')).toBe('464')
    expect(cardNumberFromName('Sugar Ray Leonard [Gold Refractor] #RG-1')).toBe('RG-1')
  })
  it('is null when there is none', () => {
    expect(cardNumberFromName('Complete Set')).toBeNull()
    expect(cardNumberFromName('1/1 Superfractor')).toBeNull()
  })
})

describe('sortSetRows', () => {
  const rows = [row('B #20', 5, '20'), row('A #3', 9, '3'), row('C #100', 50, '100'), row('Complete Set', 900), row('D #3', null, '3')]
  it('puts the checklist in numeric order, unnumbered rows last', () => {
    expect(sortSetRows(rows, 'number').map((r) => r.name)).toEqual(['A #3', 'D #3', 'B #20', 'C #100', 'Complete Set'])
  })
  it('ranks by raw value, unpriced last', () => {
    expect(sortSetRows(rows, 'value').map((r) => r.name)).toEqual(['Complete Set', 'C #100', 'A #3', 'B #20', 'D #3'])
  })
  it('does not reorder its input', () => {
    const before = rows.map((r) => r.name)
    sortSetRows(rows, 'number')
    expect(rows.map((r) => r.name)).toEqual(before)
  })
})

describe('seo rows', () => {
  it('turns a set row into a list item whose id works with get_set_cards', () => {
    expect(seoSetToItem({ slug: '1959-topps', name: '1959 Topps', year: 1959, release_date: null, card_count: 452 })).toEqual({
      set_id: '1959-topps',
      name: '1959 Topps',
      release_date: '1959',
      card_count: 452
    })
    expect(seoSetToItem({ slug: 'evolving-skies', name: 'Evolving Skies', year: 2021, release_date: '2021-08-27', card_count: 237 }).release_date).toBe('2021-08-27')
  })
  it('turns a card row into the shared list shape, with the number from the name', () => {
    const r = seoCardToListRow({ catalog_card_id: 'pricecharting-1', name: 'Don Larsen #205', game: 'baseball', set_name: 'Baseball Cards 1959 Topps', number: null, raw_market: 12.5, psa10: 900 })
    expect(r).toEqual({ id: 'pricecharting-1', name: 'Don Larsen #205', game: 'baseball', expansion_name: 'Baseball Cards 1959 Topps', number: '205', image_small: null, raw_market: 12.5, psa10_market: 900 })
  })
})

describe('queryWords', () => {
  it('splits a filter into safe words', () => {
    expect(queryWords('  1959   Topps ')).toEqual(['1959', 'topps'])
    expect(queryWords('o%neil_,(x)')).toEqual(['oneilx'])
    expect(queryWords(undefined)).toEqual([])
  })
})

import { rankSetItems, isSetChecklistRow } from '../src/lib/sets.js'

describe('rankSetItems', () => {
  const items = [
    { set_id: '2023-topps-archives-1959-fan-favorites', name: '2023 Topps Archives 1959 Fan Favorites', release_date: '2023', card_count: 68 },
    { set_id: '1959-topps-venezuela', name: '1959 Topps Venezuela', release_date: '1959', card_count: 148 },
    { set_id: '1959-topps', name: '1959 Topps', release_date: '1959', card_count: 452 }
  ]
  it('puts the set the filter names exactly first, then names that start with it', () => {
    expect(rankSetItems(items, '1959 topps').map((s) => s.set_id)).toEqual(['1959-topps', '1959-topps-venezuela', '2023-topps-archives-1959-fan-favorites'])
  })
  it('keeps newest-first order when there is no filter', () => {
    expect(rankSetItems(items, undefined)).toEqual(items)
  })
})

describe('isSetChecklistRow', () => {
  it('drops the "Complete Set" product from a set checklist', () => {
    expect(isSetChecklistRow('Complete Set')).toBe(false)
    expect(isSetChecklistRow('Mickey Mantle #10')).toBe(true)
  })
})
