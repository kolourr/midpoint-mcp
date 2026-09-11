import { z } from 'zod'

/**
 * Process configuration. Parsed once at startup so a missing secret fails
 * the boot, not the first tool call.
 */
const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().min(20),
  OPENAI_APPS_CHALLENGE_TOKEN: z.string().optional(),
  SITE_URL: z.string().url().default('https://www.cardcenteringtool.com'),
  SCRYDEX_API_KEY: z.string().optional(),
  SCRYDEX_TEAM_ID: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  /** Ceiling for known assistant hosts (ChatGPT, Claude), whose users share
   *  a few egress IPs. Defaults to 5× the per-IP limit. */
  RATE_LIMIT_PER_MINUTE_AGENTS: z.coerce.number().int().min(1).optional()
})

export type Config = z.infer<typeof schema>

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid configuration:\n  ${issues.join('\n  ')}`)
  }
  return parsed.data
}
