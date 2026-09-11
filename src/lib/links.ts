/**
 * Every tool result links back to the page that holds the full data.
 * Only informational first-party pages: never checkout, never the paywall.
 * utm_source separates plugin traffic from ChatGPT's web-search citations.
 */
const UTM = 'utm_source=chatgpt_plugin&utm_medium=mcp'

export const buildLinks = (siteUrl: string) => {
  const base = siteUrl.replace(/\/$/, '')
  return {
    card: (id: string) => `${base}/prices/${encodeURIComponent(id)}?${UTM}`,
    worthGrading: (id: string) => `${base}/worth-grading/${encodeURIComponent(id)}?${UTM}`,
    game: (game: string) => `${base}/prices/${encodeURIComponent(game)}?${UTM}`,
    setsIndex: (game: string) => `${base}/sets/${encodeURIComponent(game)}?${UTM}`,
    set: (game: string, slug: string) => `${base}/sets/${encodeURIComponent(game)}/${encodeURIComponent(slug)}?${UTM}`,
    measure: () => `${base}/measure?${UTM}`,
    worthGradingIndex: () => `${base}/worth-grading?${UTM}`
  }
}

export type Links = ReturnType<typeof buildLinks>
