/**
 * Turn tool results into Discord embeds. Pure functions (no discord.js
 * import) so they are unit-testable; the bot wraps them in EmbedBuilder.
 * Wording matches the server: "real sold listings", never a store name;
 * every embed links the card page (already utm-tagged by the server).
 * Shapes mirror the tools' output schemas in src/tools/*.ts.
 */
export interface EmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface EmbedSpec {
  title: string
  url?: string
  description?: string
  fields: EmbedField[]
  footer: string
}

export const BRAND_COLOR = 0xffcb05

export const money = (v: unknown): string => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) return '—'
  return n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`
}

const pct = (v: unknown): string => {
  const n = typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(1)}%` : '—'
}

const footer = (captured?: string | null): string => `USD market values from real sold listings${captured ? ` · as of ${captured}` : ''} · Midpoint`

/** search_cards / get_set_cards rows (cardSummarySchema). */
export interface CardSummary {
  id: string
  name: string
  game: string
  set: string | null
  number: string | null
  raw_market_usd: number | null
  psa10_market_usd?: number | null
  url: string
}

const cardLine = (c: CardSummary): string =>
  `**${c.name}**${c.set ? ` · ${c.set}${c.number ? ` #${c.number}` : ''}` : ''}\nRaw ${money(c.raw_market_usd)} · PSA 10 ${money(c.psa10_market_usd)} · [page](${c.url})`

export const searchEmbed = (query: string, cards: CardSummary[], note?: string): EmbedSpec => ({
  title: cards.length ? `Matches for "${query}"` : `No match for "${query}"`,
  description: cards.length ? cards.slice(0, 5).map(cardLine).join('\n\n') + (cards.length > 1 ? '\n\nUse `/price` with the set or number to pin one down.' : '') : note ?? 'Try the card or player name alone, or add the set.',
  fields: [],
  footer: footer(null)
})

/** get_card_prices structuredContent. */
export interface PriceLadder {
  card: { id: string; name: string; game: string; set: string | null; number: string | null }
  captured_on: string | null
  variant: string | null
  raw_note: string | null
  raw: Array<{ condition: string; market_usd: number | null }>
  graded: Array<{ company: string; grade: string; market_usd: number | null }>
  summary: { raw_market_usd: number | null; psa9_usd: number | null; psa10_usd: number | null; best_graded_usd: number | null; change_30d_pct: number | null }
  links: { card_page: string; worth_grading: string }
}

export const priceEmbed = (p: PriceLadder): EmbedSpec => {
  const raw = p.raw.filter((r) => r.market_usd != null).slice(0, 4).map((r) => `${r.condition} ${money(r.market_usd)}`).join(' · ') || '—'
  const graded = p.graded.filter((g) => g.market_usd != null).slice(0, 8).map((g) => `${g.company} ${g.grade} ${money(g.market_usd)}`).join(' · ') || '—'
  const desc = [p.variant ? `Printing: ${p.variant}` : null, p.summary.change_30d_pct != null ? `30-day change: ${pct(p.summary.change_30d_pct)}` : null, p.raw_note].filter(Boolean).join('\n')
  return {
    title: `${p.card.name}${p.card.set ? ` — ${p.card.set}` : ''}${p.card.number ? ` #${p.card.number}` : ''}`,
    url: p.links.card_page,
    description: desc || undefined,
    fields: [
      { name: 'Raw (ungraded)', value: raw },
      { name: 'Graded', value: graded },
      { name: 'Worth grading?', value: `[See the verdict](${p.links.worth_grading})` }
    ],
    footer: footer(p.captured_on)
  }
}

/** grading_roi structuredContent. */
export interface GradingRoi {
  card: { id: string; name: string; game: string; set: string | null; number: string | null }
  captured_on: string | null
  raw_market_usd: number | null
  psa9_usd: number | null
  psa10_usd: number | null
  gem_premium_multiple: number | null
  verdict: { tone: string; headline: string; body: string } | null
  net_after_fee: Array<{ outcome: string; sale_usd: number; net_usd_by_fee: Array<{ fee_usd: number; net_usd: number }> }>
  break_even_gem_probability: number | null
  assumed_fee_usd: number
  links: { worth_grading: string; card_page: string }
}

export const roiEmbed = (r: GradingRoi): EmbedSpec => {
  const netAt = (outcome: string): string => {
    const row = r.net_after_fee.find((n) => n.outcome.toLowerCase().includes(outcome.toLowerCase()))
    const fee = row?.net_usd_by_fee.find((f) => f.fee_usd === r.assumed_fee_usd) ?? row?.net_usd_by_fee[0]
    return fee ? money(fee.net_usd) : '—'
  }
  return {
    title: `Worth grading? ${r.card.name}${r.card.set ? ` — ${r.card.set}` : ''}`,
    url: r.links.worth_grading,
    description: r.verdict ? `**${r.verdict.headline}**\n${r.verdict.body}` : undefined,
    fields: [
      { name: 'Raw', value: money(r.raw_market_usd), inline: true },
      { name: 'PSA 9', value: money(r.psa9_usd), inline: true },
      { name: 'PSA 10', value: money(r.psa10_usd), inline: true },
      { name: `Net if PSA 10 (fee ${money(r.assumed_fee_usd)})`, value: netAt('10'), inline: true },
      { name: 'Net if PSA 9', value: netAt('9'), inline: true },
      { name: 'Break-even gem rate', value: r.break_even_gem_probability != null ? `${(r.break_even_gem_probability * 100).toFixed(0)}%` : 'never at this fee', inline: true }
    ],
    footer: footer(r.captured_on)
  }
}

/** trending_cards / liquid_movers rows. */
export interface Mover {
  id: string
  name: string
  game: string
  set: string | null
  number: string | null
  change_pct?: number | null
  price_now_usd?: number | null
  price_30d_ago_usd?: number | null
  raw_market_usd?: number | null
  psa10_market_usd?: number | null
  basis?: string
  url?: string
}

const moverChange = (m: Mover): string => {
  if (typeof m.change_pct === 'number') return pct(m.change_pct)
  if (typeof m.price_now_usd === 'number' && typeof m.price_30d_ago_usd === 'number' && m.price_30d_ago_usd > 0) return pct(((m.price_now_usd - m.price_30d_ago_usd) / m.price_30d_ago_usd) * 100)
  return '—'
}

export const moversEmbed = (title: string, movers: Mover[], criteria?: string): EmbedSpec => ({
  title,
  description:
    movers.length === 0
      ? 'Nothing qualifies right now.'
      : movers
          .slice(0, 10)
          .map((m, i) => `${i + 1}. **${m.name}**${m.set ? ` · ${m.set}` : ''} — ${moverChange(m)}${m.basis ? ` (${m.basis})` : ''} · ${money(m.price_now_usd ?? m.psa10_market_usd ?? m.raw_market_usd)}${m.url ? ` · [page](${m.url})` : ''}`)
          .join('\n') + (criteria ? `\n\n_${criteria}_` : ''),
  fields: [],
  footer: footer(null)
})

/** get_price_history structuredContent. */
export interface History {
  name: string
  series: string
  variant: string | null
  days: number
  coverage: { days_with_data: number; note: string }
  points: Array<{ date: string; market_usd: number | null }>
  first_usd: number | null
  last_usd: number | null
  change_pct: number | null
  change_note: string | null
  links: { card_page: string }
}

export const historyEmbed = (h: History): EmbedSpec => {
  const valid = h.points.filter((p) => p.market_usd != null)
  const step = Math.max(1, Math.floor(valid.length / 6))
  const sample = valid.filter((_, i) => i % step === 0 || i === valid.length - 1).slice(-7)
  return {
    title: `${h.name} · ${h.series} · last ${h.days} days`,
    url: h.links.card_page,
    description: valid.length === 0 ? 'No history recorded for this series yet.' : sample.map((p) => `${p.date}: ${money(p.market_usd)}`).join('\n'),
    fields: valid.length
      ? [
          { name: 'First → last', value: `${money(h.first_usd)} → ${money(h.last_usd)}${h.change_note ? ` (${h.change_note})` : ` (${pct(h.change_pct)})`}` },
          { name: 'Coverage', value: `${h.coverage.days_with_data} of ${h.days} days${h.variant ? ` · printing: ${h.variant}` : ''}. ${h.coverage.note}` }
        ]
      : [],
    footer: footer(valid[valid.length - 1]?.date ?? null)
  }
}

/** get_set_cards structuredContent. */
export interface SetCards {
  set_name: string | null
  total_cards: number
  cards: CardSummary[]
}

export const setEmbed = (s: SetCards, sort: string): EmbedSpec => ({
  title: `${s.set_name ?? 'Set'} · ${sort === 'value' ? 'most valuable' : 'checklist'} (${s.total_cards} cards)`,
  description: s.cards.length === 0 ? 'No priced cards in this set yet.' : s.cards.slice(0, 10).map((c, i) => `${i + 1}. **${c.name}**${c.number ? ` #${c.number}` : ''} — raw ${money(c.raw_market_usd)} · PSA 10 ${money(c.psa10_market_usd)} · [page](${c.url})`).join('\n'),
  fields: [],
  footer: footer(null)
})

export const errorEmbed = (message: string): EmbedSpec => ({ title: 'Midpoint could not answer that', description: message, fields: [], footer: 'Midpoint' })
