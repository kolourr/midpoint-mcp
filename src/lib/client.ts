/**
 * Which MCP host is calling, from the HTTP User-Agent. The transport is
 * stateless, so the initialize handshake's clientInfo is not available on
 * later tool calls; the User-Agent is the one signal every request carries.
 * Used only to set utm_source on the links in tool results so website
 * analytics can separate ChatGPT, Claude, Cursor and other agents.
 */
const RULES: Array<[pattern: RegExp, source: string]> = [
  [/openai|chatgpt/i, 'chatgpt_plugin'],
  [/claude-code/i, 'claude_code'],
  [/claude|anthropic/i, 'claude'],
  [/cursor/i, 'cursor'],
  [/windsurf|codeium/i, 'windsurf'],
  [/inspector/i, 'mcp_inspector'],
  [/gemini|google/i, 'gemini'],
  [/copilot|vscode/i, 'copilot']
]

/** Hosts whose users all arrive from a shared egress range. */
const SHARED_EGRESS = new Set(['chatgpt_plugin', 'claude'])
export const isSharedEgressHost = (utmSource: string): boolean => SHARED_EGRESS.has(utmSource)

export const utmSourceFor = (userAgent: string | undefined): string => {
  if (!userAgent) return 'mcp'
  for (const [pattern, source] of RULES) {
    if (pattern.test(userAgent)) return source
  }
  return 'mcp'
}
