/**
 * Midpoint Discord bot — the nine MCP tools as slash commands, answered
 * as embeds. Runs as a second process from this repo (Dockerfile.discord)
 * and talks to the public MCP server over HTTP, so it has no database
 * access and no secrets beyond the bot token. Every card link it posts
 * carries utm_source=discord (the server tags links by client) and the
 * server counts its calls under the "discord" client.
 *
 *   /price <card>            search + full ladder for the top match
 *   /grade <card> [fee]      worth grading? (grading_roi)
 *   /history <card> [days] [grade]
 *   /trending [game] [direction]
 *   /movers [game]           rising cards that actually sell
 *   /set <game> <set>        most valuable cards in a set
 *
 * Env: DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, MCP_URL (defaults to prod).
 */
import { Client, EmbedBuilder, GatewayIntentBits, REST, Routes, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js'
import { GAME_KEYS, gameLabel } from '../lib/games.js'
import { errorEmbed, historyEmbed, moversEmbed, priceEmbed, roiEmbed, searchEmbed, setEmbed, BRAND_COLOR, type CardSummary, type EmbedSpec, type GradingRoi, type History, type Mover, type PriceLadder, type SetCards } from './embeds.js'
import { McpHttpClient } from './mcp-client.js'

const token = process.env.DISCORD_BOT_TOKEN
const clientId = process.env.DISCORD_CLIENT_ID
const mcpUrl = process.env.MCP_URL ?? 'https://mcp.cardcenteringtool.com/mcp'
const appLink = process.env.APP_LINK ?? 'https://www.cardcenteringtool.com/go/discord'
if (!token || !clientId) {
  console.error('DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID are required')
  process.exit(1)
}

const mcp = new McpHttpClient(mcpUrl)

const gameChoices = GAME_KEYS.slice(0, 25).map((k) => ({ name: gameLabel(k), value: k }))

const commands = [
  new SlashCommandBuilder().setName('price').setDescription('Card price: raw by condition and the graded ladder').addStringOption((o) => o.setName('card').setDescription('Card name, set and/or number').setRequired(true).setMaxLength(80)).addStringOption((o) => o.setName('game').setDescription('Game or sport').addChoices(...gameChoices)),
  new SlashCommandBuilder().setName('grade').setDescription('Is this card worth grading?').addStringOption((o) => o.setName('card').setDescription('Card name, set and/or number').setRequired(true).setMaxLength(80)).addIntegerOption((o) => o.setName('fee').setDescription('Grading fee in USD (default 25)').setMinValue(1).setMaxValue(2000)).addStringOption((o) => o.setName('game').setDescription('Game or sport').addChoices(...gameChoices)),
  new SlashCommandBuilder().setName('history').setDescription('Price history for a card').addStringOption((o) => o.setName('card').setDescription('Card name, set and/or number').setRequired(true).setMaxLength(80)).addIntegerOption((o) => o.setName('days').setDescription('7 to 180 (default 90)').setMinValue(7).setMaxValue(180)).addStringOption((o) => o.setName('grade').setDescription('PSA grade series, e.g. 10 (default raw)').setMaxLength(4)).addStringOption((o) => o.setName('game').setDescription('Game or sport').addChoices(...gameChoices)),
  new SlashCommandBuilder().setName('trending').setDescription('Biggest 30-day movers').addStringOption((o) => o.setName('game').setDescription('Game or sport').addChoices(...gameChoices)).addStringOption((o) => o.setName('direction').setDescription('up or down').addChoices({ name: 'up', value: 'up' }, { name: 'down', value: 'down' })),
  new SlashCommandBuilder().setName('movers').setDescription('Rising cards that actually sell').addStringOption((o) => o.setName('game').setDescription('Game or sport').addChoices(...gameChoices)),
  new SlashCommandBuilder().setName('set').setDescription('Most valuable cards in a set').addStringOption((o) => o.setName('game').setDescription('Game or sport').setRequired(true).addChoices(...gameChoices)).addStringOption((o) => o.setName('set').setDescription('Set name, e.g. Evolving Skies').setRequired(true).setMaxLength(60))
].map((c) => c.toJSON())

const toEmbed = (spec: EmbedSpec): EmbedBuilder => {
  const e = new EmbedBuilder().setColor(BRAND_COLOR).setTitle(spec.title.slice(0, 256)).setFooter({ text: spec.footer.slice(0, 2048) })
  if (spec.url) e.setURL(spec.url)
  if (spec.description) e.setDescription(spec.description.slice(0, 4096))
  if (spec.fields.length) e.addFields(spec.fields.map((f) => ({ name: f.name.slice(0, 256), value: f.value.slice(0, 1024) || '—', inline: f.inline ?? false })))
  return e
}

const structured = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
  const r = await mcp.callTool(name, args)
  if (r.isError) throw new Error(r.content?.[0]?.text ?? 'tool error')
  if (!r.structuredContent) throw new Error('empty result')
  return r.structuredContent as T
}

/** search_cards → top match, or null with the search embed to show instead. */
const findCard = async (query: string, game?: string | null): Promise<{ card: CardSummary; cards: CardSummary[] } | { card: null; embed: EmbedSpec }> => {
  const s = await structured<{ cards: CardSummary[]; note?: string }>('search_cards', { query, ...(game ? { game } : {}), limit: 5 })
  const top = s.cards[0]
  if (!top) return { card: null, embed: searchEmbed(query, [], s.note) }
  return { card: top, cards: s.cards }
}

const appFooterLine = `\n\nScan, grade and track your own cards in the Midpoint app: ${appLink}`

const handlers: Record<string, (i: ChatInputCommandInteraction) => Promise<EmbedSpec[]>> = {
  price: async (i) => {
    const found = await findCard(i.options.getString('card', true), i.options.getString('game'))
    if (!found.card) return [found.embed]
    const p = await structured<PriceLadder>('get_card_prices', { card_id: found.card.id })
    const embeds = [priceEmbed(p)]
    if (found.cards.length > 1) embeds.push(searchEmbed('other matches', found.cards.slice(1, 4)))
    return embeds
  },
  grade: async (i) => {
    const found = await findCard(i.options.getString('card', true), i.options.getString('game'))
    if (!found.card) return [found.embed]
    const fee = i.options.getInteger('fee')
    const r = await structured<GradingRoi>('grading_roi', { card_id: found.card.id, ...(fee ? { grading_fee_usd: fee } : {}) })
    return [roiEmbed(r)]
  },
  history: async (i) => {
    const found = await findCard(i.options.getString('card', true), i.options.getString('game'))
    if (!found.card) return [found.embed]
    const days = i.options.getInteger('days') ?? 90
    const grade = i.options.getString('grade')
    const h = await structured<History>('get_price_history', { card_id: found.card.id, days, ...(grade ? { grade } : {}) })
    return [historyEmbed(h)]
  },
  trending: async (i) => {
    const game = i.options.getString('game')
    const direction = i.options.getString('direction') ?? 'up'
    const t = await structured<{ cards: Mover[]; criteria: string }>('trending_cards', { ...(game ? { game } : {}), direction, limit: 10 })
    return [moversEmbed(`${direction === 'down' ? 'Biggest drops' : 'Biggest gainers'} · 30 days${game ? ` · ${gameLabel(game)}` : ''}`, t.cards, t.criteria)]
  },
  movers: async (i) => {
    const game = i.options.getString('game')
    const m = await structured<{ cards: Mover[]; criteria: string }>('liquid_movers', { ...(game ? { game } : {}), limit: 10 })
    return [moversEmbed(`Rising cards that actually sell${game ? ` · ${gameLabel(game)}` : ''}`, m.cards, m.criteria)]
  },
  set: async (i) => {
    const game = i.options.getString('game', true)
    const query = i.options.getString('set', true)
    const sets = await structured<{ sets: Array<{ set_id: string; name: string | null }> }>('list_sets', { game, query, limit: 3 })
    const hit = sets.sets[0]
    if (!hit) return [errorEmbed(`No set matching "${query}" in ${gameLabel(game)}.`)]
    const s = await structured<SetCards>('get_set_cards', { game, set_id: hit.set_id, sort: 'value', limit: 10 })
    return [setEmbed(s, 'value')]
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] })

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return
  const handler = handlers[interaction.commandName]
  if (!handler) return
  try {
    await interaction.deferReply()
    const specs = await handler(interaction)
    const last = specs[specs.length - 1]
    if (last) last.description = `${last.description ?? ''}${appFooterLine}`.trim()
    await interaction.editReply({ embeds: specs.slice(0, 3).map(toEmbed) })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Something went wrong.'
    console.error(`[discord] /${interaction.commandName} failed:`, message)
    const embed = toEmbed(errorEmbed(message.includes('rate limited') ? 'Too many requests right now — try again in a minute.' : message.slice(0, 300)))
    if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds: [embed] }).catch(() => undefined)
    else await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => undefined)
  }
})

client.once('clientReady', () => {
  console.log(`[discord] ready as ${client.user?.tag} · MCP ${mcpUrl}`)
})

const main = async (): Promise<void> => {
  const rest = new REST({ version: '10' }).setToken(token)
  await rest.put(Routes.applicationCommands(clientId), { body: commands })
  console.log(`[discord] registered ${commands.length} commands`)
  await client.login(token)
}

const shutdown = (signal: string): void => {
  console.log(`${signal} received, closing`)
  void client.destroy()
  setTimeout(() => process.exit(0), 2000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

main().catch((err) => {
  console.error('[discord] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
