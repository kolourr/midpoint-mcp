/**
 * Every tool result links back to the page that holds the full data.
 * Only informational first-party pages: never checkout, never the paywall.
 * utm_source names the calling client (see client.ts) so plugin traffic is
 * attributable per host; utm_medium is always "mcp".
 */
export const buildLinks = (siteUrl: string, utmSource = 'mcp') => {
  const base = siteUrl.replace(/\/$/, '')
  const utm = `utm_source=${encodeURIComponent(utmSource)}&utm_medium=mcp`
  return {
    card: (id: string) => `${base}/prices/${encodeURIComponent(id)}?${utm}`,
    worthGrading: (id: string) => `${base}/worth-grading/${encodeURIComponent(id)}?${utm}`,
    game: (game: string) => `${base}/prices/${encodeURIComponent(game)}?${utm}`,
    setsIndex: (game: string) => `${base}/sets/${encodeURIComponent(game)}?${utm}`,
    set: (game: string, slug: string) => `${base}/sets/${encodeURIComponent(game)}/${encodeURIComponent(slug)}?${utm}`,
    measure: () => `${base}/measure?${utm}`,
    worthGradingIndex: () => `${base}/worth-grading?${utm}`
  }
}

export type Links = ReturnType<typeof buildLinks>
