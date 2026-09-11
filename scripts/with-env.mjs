#!/usr/bin/env node
/**
 * Run a command with env loaded from a dotenv-style file. Local dev only.
 * Accepts a few alias names for the Supabase variables so an existing
 * project env file can be reused as-is.
 *
 *   node scripts/with-env.mjs .env -- npm run dev
 */
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const [file, dashes, ...cmd] = process.argv.slice(2)
if (!file || dashes !== '--' || cmd.length === 0) {
  console.error('usage: with-env.mjs <envfile> -- <command...>')
  process.exit(2)
}

const parsed = Object.fromEntries(
  readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const idx = line.indexOf('=')
      const key = line.slice(0, idx).trim()
      const raw = line.slice(idx + 1).trim()
      const value = raw.replace(/^(['"])(.*)\1$/, '$2')
      return [key, value]
    })
)

const ALIASES = {
  SUPABASE_URL: ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'],
  SUPABASE_SECRET_KEY: ['SUPABASE_SECRET_KEY', 'NEXT_SUPABASE_SECRET', 'SUPABASE_SERVICE_ROLE_KEY'],
  SCRYDEX_API_KEY: ['SCRYDEX_API_KEY'],
  SCRYDEX_TEAM_ID: ['SCRYDEX_TEAM_ID']
}

const env = { ...process.env }
for (const [target, sources] of Object.entries(ALIASES)) {
  if (env[target]) continue
  const hit = sources.find((s) => parsed[s])
  if (hit) env[target] = parsed[hit]
}

const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', env, shell: false })
child.on('exit', (code) => process.exit(code ?? 1))
