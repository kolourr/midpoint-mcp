/**
 * Minimal Scrydex price-history client. Only used when credentials are
 * configured; each uncached call costs 3 credits, so results are cached
 * 24h in scrydex_cache with the same key format midpoint-web uses.
 */
const BASE = 'https://api.scrydex.com'

export interface ScrydexHistoryDay {
  date: string
  prices: Array<{ market?: number | null; low?: number | null; high?: number | null; is_signed?: boolean; is_error?: boolean; is_perfect?: boolean }>
}

export const fetchScrydexHistory = async (
  creds: { apiKey: string; teamId: string },
  game: string,
  cardId: string,
  params: { days: number; company?: string; grade?: string }
): Promise<ScrydexHistoryDay[]> => {
  const url = new URL(`${BASE}/${game}/v1/cards/${encodeURIComponent(cardId)}/price_history`)
  url.searchParams.set('days', String(params.days))
  url.searchParams.set('page_size', '100')
  if (params.company) url.searchParams.set('company', params.company)
  if (params.grade) url.searchParams.set('grade', params.grade)
  const res = await fetch(url, { headers: { 'X-Api-Key': creds.apiKey, 'X-Team-ID': creds.teamId }, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Scrydex ${res.status}`)
  const body = (await res.json()) as { data?: ScrydexHistoryDay[] }
  return body.data ?? []
}
