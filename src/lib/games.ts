/** Exact `card_catalog.game` keys the catalog uses, with display labels. */
export const GAMES = {
  pokemon: 'Pokémon',
  magicthegathering: 'Magic: The Gathering',
  yugioh: 'Yu-Gi-Oh!',
  onepiece: 'One Piece',
  lorcana: 'Disney Lorcana',
  riftbound: 'Riftbound',
  gundam: 'Gundam Card Game',
  dragonball: 'Dragon Ball',
  digimon: 'Digimon',
  baseball: 'Baseball',
  basketball: 'Basketball',
  football: 'Football',
  hockey: 'Hockey',
  soccer: 'Soccer',
  wrestling: 'Wrestling',
  ufc: 'UFC',
  racing: 'Racing',
  tennis: 'Tennis',
  golf: 'Golf',
  boxing: 'Boxing',
  marvel: 'Marvel',
  starwars: 'Star Wars',
  gpk: 'Garbage Pail Kids',
  entertainment: 'Entertainment',
  othertcg: 'Other TCGs'
} as const

export type GameKey = keyof typeof GAMES
export const GAME_KEYS = Object.keys(GAMES) as [GameKey, ...GameKey[]]
export const gameLabel = (key: string | null | undefined): string =>
  (key && (GAMES as Record<string, string>)[key]) || key || 'Trading cards'

/** Games whose ids resolve against Scrydex (live price history). */
export const SCRYDEX_GAMES = new Set(['pokemon', 'magicthegathering', 'lorcana', 'onepiece', 'gundam', 'riftbound'])

export const PC_ID_PREFIX = 'pricecharting-'
export const isPriceChartingId = (id: string): boolean => id.startsWith(PC_ID_PREFIX)
