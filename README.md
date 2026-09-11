# Midpoint MCP server

Trading-card market prices and grading ROI as [Model Context Protocol](https://modelcontextprotocol.io)
tools. Read-only, no account, no API key. Powers the **Midpoint Card Prices** plugin in ChatGPT and works
with Claude, Claude Code, Cursor and any MCP client.

- **Endpoint:** `https://mcp.cardcenteringtool.com/mcp` (Streamable HTTP)
- **Docs and connect instructions:** <https://www.cardcenteringtool.com/mcp>
- **Official MCP Registry:** `com.cardcenteringtool/card-prices` (<https://registry.modelcontextprotocol.io/v0.1/servers?search=com.cardcenteringtool>)
- **Data:** 1.5M+ Pokémon, Magic, Yu-Gi-Oh!, One Piece, Lorcana, Gundam, sports and entertainment cards; USD
  market values from real sold listings, refreshed daily. Same data as <https://www.cardcenteringtool.com/prices>.

## What you can ask

Plain questions in a collector's words. The assistant picks the tool, finds the card and answers with
prices, the capture date and a link to the card page.

- *"What is a PSA 10 Base Set Charizard worth?"* · *"Is my Umbreon VMAX alt art worth grading?"*
- *"1986 Fleer Michael Jordan raw and PSA 10 price"* · *"Luka Doncic Prizm Silver rookie value"*
- *"1952 Topps Mickey Mantle PSA 10 price history"* · *"Is my Shohei Ohtani rookie worth grading?"*
- *"Alpha Black Lotus price"* · *"LOB-001 Blue-Eyes White Dragon 1st edition"* · *"OP-01 Manga Luffy"*
- *"Which Pokémon cards jumped the most this month?"* · *"Which rising cards actually sell?"*
- *"Most valuable cards in Evolving Skies"* · *"Best basketball cards to grade"*

Every answer can include raw prices by condition (NM/LP/MP/HP), the graded ladder for PSA, CGC, BGS, SGC
and TAG, the PSA 9 and PSA 10 premium over raw, net profit after $25/$50/$150 fees, expected value by gem
rate, the break-even gem rate, 7–180 days of price history, 30-day movers, liquid movers, best cards to
grade, and priced set checklists.

Coverage: Pokémon, Magic: The Gathering, Yu-Gi-Oh!, One Piece, Disney Lorcana, Riftbound, Gundam, Dragon
Ball, Digimon; baseball, basketball, football, hockey, soccer, wrestling, UFC, racing, tennis, golf, boxing;
Marvel, Star Wars, Garbage Pail Kids and other entertainment and TCG sets.

## Installation

Remote server, nothing to install. Add it to any MCP client that supports HTTP servers:

```json
{
  "mcpServers": {
    "midpoint": {
      "url": "https://mcp.cardcenteringtool.com/mcp"
    }
  }
}
```

Clients that only speak stdio (Claude Desktop, some IDE plugins) can bridge with `mcp-remote`:

```json
{
  "mcpServers": {
    "midpoint": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.cardcenteringtool.com/mcp"]
    }
  }
}
```

- **ChatGPT:** install *Midpoint Card Prices* from the plugin directory, or in Developer Mode add a
  connector with the endpoint.
- **Claude (web, desktop, mobile):** Customize → Connectors → Add custom connector → paste the endpoint.
- **Claude Code:** `claude mcp add --transport http midpoint https://mcp.cardcenteringtool.com/mcp`
- **Cursor / Windsurf / others:** paste the JSON above into the client's MCP settings.
- **MCP Inspector:** `npx @modelcontextprotocol/inspector` and connect to the endpoint.

No authentication. Streamable HTTP transport. Rate limited per client IP.

## Tools

### search_cards

Find cards by name, set, number or year and return raw and PSA 10 USD prices with the card id.

**Inputs:** `query`, `game?`, `set_id?`, `limit?`

### get_card_prices

Full price ladder for one card: raw by condition (NM/LP/MP/HP) and graded prices for PSA, CGC, BGS, SGC and TAG by grade.

**Inputs:** `card_id`

### grading_roi

Is this card worth grading? Raw vs PSA 9 vs PSA 10, gem premium, net profit after $25/$50/$150 fees, expected value by gem rate, break-even gem rate, which company pays most, and a plain verdict.

**Inputs:** `card_id`, `grading_fee_usd?`

### get_price_history

Dated market values over 7 to 180 days for the raw series or a PSA grade.

**Inputs:** `card_id`, `days?`, `grade?`

### best_cards_to_grade

Cards with the biggest expected net profit from grading in a game or set (half PSA 10, half PSA 9, minus raw and the fee; both graded prices required).

**Inputs:** `game`, `set_slug?`, `grading_fee_usd?`, `limit?`

### trending_cards

Biggest 30-day gainers or drops, one game or all.

**Inputs:** `game?`, `direction?`, `min_market_usd?`, `limit?`

### liquid_movers

Rising cards with real sales volume (25+ sales a year).

**Inputs:** `game?`, `limit?`

### list_sets

Sets and expansions for a game, newest first, with ids.

**Inputs:** `game`, `query?`, `limit?`

### get_set_cards

Priced checklist or most valuable cards in a set.

**Inputs:** `game`, `set_id`, `sort?`, `limit?`

Every tool is read-only (`readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`), returns
`structuredContent` with an output schema, and links back to the matching page on cardcenteringtool.com.
Card ids are the public URL keys (`swsh7-215`, `pricecharting-1821843`).

Game keys: `pokemon magicthegathering yugioh onepiece lorcana riftbound gundam dragonball digimon baseball
basketball football hockey soccer wrestling ufc racing tennis golf boxing marvel starwars gpk entertainment
othertcg`.

## Data handling

Requests carry only the tool arguments (card names, ids, filters) and the caller's IP for rate limiting.
Privacy policy: <https://www.cardcenteringtool.com/privacy>. Support:
<https://www.cardcenteringtool.com/contact>.
