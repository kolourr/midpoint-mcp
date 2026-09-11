import { describe, expect, it } from 'vitest'
import { fallbackTerm, isImplausibleRaw, parseQuery, rankRows, rowValue, searchTerms, unionRows } from '../src/lib/search.js'
import type { CatalogListRow } from '../src/lib/prices.js'

const row = (over: Partial<CatalogListRow>): CatalogListRow => ({
  id: 'x', name: 'Card', game: 'pokemon', expansion_name: null, number: null, image_small: null, raw_market: 1, ...over
})

describe('parseQuery', () => {
  it('splits years, numbers and name tokens', () => {
    const p = parseQuery('1986 Fleer Michael Jordan #57')
    expect(p.years).toEqual(['1986'])
    expect(p.numbers).toEqual(['57'])
    expect(p.terms[0]).toBe('michael')
    expect(p.tokens).toEqual(['fleer', 'michael', 'jordan'])
  })
  it('drops stop words from terms but keeps card numbers with slashes', () => {
    const p = parseQuery('Charizard base set 4/102 PSA 10')
    expect(p.terms).toEqual(['charizard', 'base'])
    expect(p.numbers).toEqual(['4/102', '10'])
  })
})

describe('searchTerms', () => {
  it('returns the full query plus the two most distinctive tokens', () => {
    expect(searchTerms('charizard base set')).toEqual(['charizard base set', 'charizard', 'base'])
    expect(searchTerms('1986 fleer michael jordan')).toEqual(['1986 fleer michael jordan', 'michael', 'jordan'])
    expect(fallbackTerm('1986 fleer michael jordan')).toBe('fleer michael')
    expect(fallbackTerm('jordan')).toBeNull()
  })
  it('unions batches by id keeping first-seen order', () => {
    const a = row({ id: 'a' }); const b = row({ id: 'b' }); const a2 = row({ id: 'a', name: 'dup' })
    expect(unionRows([[a, b], [a2]]).map((r) => r.id)).toEqual(['a', 'b'])
  })
  it('handles a single word', () => {
    expect(searchTerms('Umbreon')).toEqual(['umbreon'])
  })
})

describe('rankRows', () => {
  it('prefers rows whose set and number match the rest of the query', () => {
    const p = parseQuery('charizard base set 4/102')
    const rows = [
      row({ id: 'a', name: 'Charizard', expansion_name: 'Obsidian Flames', number: '125' }),
      row({ id: 'b', name: 'Charizard', expansion_name: 'Base', number: '4' }),
      row({ id: 'c', name: 'Charizard ex', expansion_name: 'Base Set 2', number: '4' })
    ]
    expect(rankRows(rows, p).map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })
  it('breaks ties by market value, then first-seen order', () => {
    const p = parseQuery('jordan')
    const rows = [row({ id: 'cheap', name: 'Michael Jordan', raw_market: 5 }), row({ id: 'dear', name: 'Michael Jordan', raw_market: 500 }), row({ id: 'same', name: 'Michael Jordan', raw_market: 500 })]
    expect(rankRows(rows, p).map((r) => r.id)).toEqual(['dear', 'same', 'cheap'])
  })
  it('treats game names as stop words so the character name gets queried', () => {
    expect(searchTerms('elsa lorcana enchanted')).toEqual(['elsa lorcana enchanted', 'enchanted', 'elsa'])
  })
  it('demotes a raw price above 3x the PSA 10 and values rows by max(raw, psa10)', () => {
    const troll = row({ id: 'troll', name: 'Charizard-GX', raw_market: 400000, psa10_market: 900 })
    const real = row({ id: 'real', name: 'Charizard', raw_market: 2000, psa10_market: 20000 })
    expect(isImplausibleRaw(troll)).toBe(true)
    expect(rowValue(troll)).toBe(900)
    expect(rowValue(real)).toBe(20000)
    expect(rankRows([troll, real], parseQuery('charizard'))[0]?.id).toBe('real')
  })
  it('prefers the year in the set over a year in the card name (reprints)', () => {
    const p = parseQuery('1952 topps mickey mantle')
    const rows = [
      row({ id: 'reprint', name: 'Mickey Mantle [1952]', expansion_name: 'Baseball Cards 1991 Topps Reprint', raw_market: 18 }),
      row({ id: 'real', name: 'Mickey Mantle #311', expansion_name: 'Baseball Cards 1952 Topps', raw_market: 50000 })
    ]
    expect(rankRows(rows, p)[0]?.id).toBe('real')
  })
})
