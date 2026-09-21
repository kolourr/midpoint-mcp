import { describe, expect, it } from 'vitest'
import { historyEmbed, moversEmbed, priceEmbed, roiEmbed, searchEmbed } from '../src/discord/embeds.js'
import { parseRpc } from '../src/discord/mcp-client.js'

describe('parseRpc', () => {
  it('reads a JSON body', () => {
    expect(parseRpc('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}', 'application/json')).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } })
  })
  it('reads the last data line of an SSE body', () => {
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"first":true}}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"last":true}}\n\n'
    expect(parseRpc(sse, 'text/event-stream')).toEqual({ jsonrpc: '2.0', id: 1, result: { last: true } })
  })
})

const card = { id: 'swsh7-215', name: 'Umbreon VMAX', game: 'pokemon', set: 'Evolving Skies', number: '215', raw_market_usd: 2283.14, psa10_market_usd: 3882, url: 'https://www.cardcenteringtool.com/prices/swsh7-215?utm_source=discord&utm_medium=mcp' }

describe('embeds', () => {
  it('search lists matches with prices and page links, and says so when empty', () => {
    const e = searchEmbed('umbreon', [card])
    expect(e.title).toContain('umbreon')
    expect(e.description).toContain('Umbreon VMAX')
    expect(e.description).toContain('$2,283')
    expect(e.description).toContain('[page](https://')
    expect(searchEmbed('zzz', []).title).toContain('No match')
  })
  it('price ladder shows raw, graded and the worth-grading link', () => {
    const e = priceEmbed({
      card: { id: card.id, name: card.name, game: 'pokemon', set: card.set, number: card.number },
      captured_on: '2026-09-21',
      variant: 'holofoil',
      raw_note: null,
      raw: [{ condition: 'NM', market_usd: 2283.14 }, { condition: 'LP', market_usd: 1900 }],
      graded: [{ company: 'PSA', grade: '10', market_usd: 3882 }, { company: 'PSA', grade: '9', market_usd: 2337 }],
      summary: { raw_market_usd: 2283.14, psa9_usd: 2337, psa10_usd: 3882, best_graded_usd: 3882, change_30d_pct: 4.2 },
      links: { card_page: card.url, worth_grading: 'https://www.cardcenteringtool.com/worth-grading/swsh7-215' }
    })
    expect(e.fields[0]?.value).toBe('NM $2,283 · LP $1,900')
    expect(e.fields[1]?.value).toContain('PSA 10 $3,882')
    expect(e.description).toContain('holofoil')
    expect(e.description).toContain('+4.2%')
    expect(e.footer).toContain('real sold listings')
    expect(e.footer).toContain('2026-09-21')
  })
  it('grading verdict picks the net at the assumed fee', () => {
    const e = roiEmbed({
      card: { id: card.id, name: card.name, game: 'pokemon', set: card.set, number: card.number },
      captured_on: '2026-09-21',
      raw_market_usd: 2283,
      psa9_usd: 2337,
      psa10_usd: 3882,
      gem_premium_multiple: 1.7,
      verdict: { tone: 'conditional', headline: 'Only if the centering holds', body: 'PSA 9 barely covers the fee.' },
      net_after_fee: [
        { outcome: 'PSA 10', sale_usd: 3882, net_usd_by_fee: [{ fee_usd: 25, net_usd: 1574 }, { fee_usd: 50, net_usd: 1549 }] },
        { outcome: 'PSA 9', sale_usd: 2337, net_usd_by_fee: [{ fee_usd: 25, net_usd: 29 }, { fee_usd: 50, net_usd: 4 }] }
      ],
      break_even_gem_probability: 0.02,
      assumed_fee_usd: 50,
      links: { worth_grading: 'https://x/wg', card_page: card.url }
    })
    expect(e.description).toContain('Only if the centering holds')
    expect(e.fields.find((f) => f.name.startsWith('Net if PSA 10'))?.value).toBe('$1,549')
    expect(e.fields.find((f) => f.name === 'Net if PSA 9')?.value).toBe('$4.00')
    expect(e.fields.find((f) => f.name === 'Break-even gem rate')?.value).toBe('2%')
  })
  it('movers rank with the change and history samples the series', () => {
    const m = moversEmbed('Gainers', [{ id: 'a', name: 'Card A', game: 'pokemon', set: 'S', number: '1', basis: 'PSA 10', price_30d_ago_usd: 100, price_now_usd: 150, url: 'https://x/a' }], 'PSA 10 where present')
    expect(m.description).toContain('1. **Card A**')
    expect(m.description).toContain('+50.0%')
    const h = historyEmbed({
      name: 'Card A',
      series: 'raw',
      variant: null,
      days: 30,
      coverage: { days_with_data: 30, note: 'Daily captures.' },
      points: Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, market_usd: 100 + i })),
      first_usd: 100,
      last_usd: 129,
      change_pct: 29,
      change_note: null,
      links: { card_page: 'https://x/a' }
    })
    expect(h.fields[0]?.value).toContain('$100 → $129')
    expect(h.fields[0]?.value).toContain('+29.0%')
    expect(h.description?.split('\n').length).toBeLessThanOrEqual(7)
  })
})
