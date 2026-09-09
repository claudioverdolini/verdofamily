import { createClient } from '@supabase/supabase-js'

const defaultUrl = 'https://dufenyedfayvejlxjfqj.supabase.co'
const defaultPublishableKey = 'sb_publishable_lzhfgdq46iyPF07ZL1YmhQ_hh8wsla2'

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || defaultUrl
const supabasePublishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || defaultPublishableKey

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      },
      realtime: {
        params: { eventsPerSecond: 10 }
      }
    })
  : null

export type OnlineFamilyDocument = {
  family_id: string
  data: unknown
  revision: number
  updated_at: string
  updated_by: string | null
}
