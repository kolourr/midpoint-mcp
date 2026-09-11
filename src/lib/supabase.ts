import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { WebSocketLikeConstructor } from '@supabase/realtime-js'
import WebSocket from 'ws'

export type ServiceClient = SupabaseClient

/**
 * Service-role client. All pricing tables and RPCs are revoked from anon
 * and authenticated roles, so this is the only key that can read them.
 * The MCP server never forwards it and never accepts user tokens.
 *
 * `ws` is supplied because supabase-js constructs a realtime client eagerly
 * and Node 20 has no native WebSocket; we never open a realtime channel.
 */
export const createServiceClient = (url: string, secret: string): ServiceClient =>
  createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as WebSocketLikeConstructor },
    global: { headers: { 'x-application-name': 'midpoint-mcp' } }
  })
