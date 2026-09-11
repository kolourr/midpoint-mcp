# Midpoint MCP server

Trading-card market prices and grading ROI as [Model Context Protocol](https://modelcontextprotocol.io)
tools. Read-only, no account, no API key. Powers the **Midpoint Card Prices** plugin in ChatGPT and works
with Claude, Claude Code, Cursor and any MCP client.

- **Endpoint:** `https://mcp.cardcenteringtool.com/mcp` (Streamable HTTP)
- **Docs and connect instructions:** <https://www.cardcenteringtool.com/mcp>
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

## Tools

| Tool | Use it when | Inputs |
|---|---|---|
| `search_cards` | the user names a card | `query`, `game?`, `set_id?`, `limit?` |
| `get_card_prices` | full raw + graded ladder for one card | `card_id` |
| `grading_roi` | "is this worth grading?", PSA 10 vs raw, fees, expected value | `card_id`, `grading_fee_usd?` |
| `get_price_history` | trend over 7–180 days, raw or a PSA grade | `card_id`, `days?`, `grade?` |
| `best_cards_to_grade` | biggest gem premiums in a game or set | `game`, `set_slug?`, `limit?` |
| `trending_cards` | biggest 30-day gainers or drops | `game?`, `direction?`, `min_market_usd?`, `limit?` |
| `liquid_movers` | rising cards that actually sell | `game?`, `limit?` |
| `list_sets` | find a set id | `game`, `query?`, `limit?` |
| `get_set_cards` | priced checklist / most valuable in a set | `game`, `set_id`, `sort?`, `limit?` |

Every tool is annotated `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`, returns
`structuredContent` with an output schema, and links back to the matching page on cardcenteringtool.com.
Card ids are the public URL keys (`swsh7-215`, `pricecharting-1821843`).

Game keys: `pokemon magicthegathering yugioh onepiece lorcana riftbound gundam dragonball digimon baseball
basketball football hockey soccer wrestling ufc racing tennis golf boxing marvel starwars gpk entertainment
othertcg`.

## Connect

- **ChatGPT:** install *Midpoint Card Prices* from the plugin directory, or in Developer Mode add a
  connector with the endpoint above.
- **Claude:** Customize → Connectors → Add custom connector → paste the endpoint (no auth).
- **Claude Code:** `claude mcp add --transport http midpoint https://mcp.cardcenteringtool.com/mcp`
- **Other clients:** add `{ "mcpServers": { "midpoint": { "url": "https://mcp.cardcenteringtool.com/mcp" } } }`
  to the client's MCP config.
- **MCP Inspector:** `npx @modelcontextprotocol/inspector` and connect to the endpoint.

## Data handling

Requests carry only the tool arguments (card names, ids, filters) and the caller's IP for rate limiting.
Privacy policy: <https://www.cardcenteringtool.com/privacy>. Support:
<https://www.cardcenteringtool.com/contact>.
