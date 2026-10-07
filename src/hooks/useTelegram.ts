import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * The browser never talks to Telegram — the bot token lives on the server. All
 * the app does is manage the link (a one-time code the user hands to the bot)
 * and queue the odd test message.
 *
 * The bot's username comes from the environment, not from here: it is the one
 * piece of this that differs per deployment, and a wrong value is silent —
 * "Telegram'da aç" would open somebody else's bot, where the code means nothing
 * and the person is simply told to pair. Unset, the link is hidden rather than
 * pointed somewhere wrong (see TelegramSettings).
 */
export const TELEGRAM_BOT_USERNAME = (import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined)?.replace(/^@/, '') ?? ''

export interface TelegramAccount {
  user_id: string
  chat_id: number
  username: string | null
  first_name: string | null
  linked_at: string
  blocked_at: string | null
}

export function useTelegramAccount() {
  return useQuery({
    queryKey: ['telegram-account'],
    queryFn: async () => {
      // RLS returns this user's row and nothing else.
      const { data, error } = await supabase.from('telegram_accounts').select('*').maybeSingle()
      if (error) throw error
      return (data as TelegramAccount | null) ?? null
    },
    refetchInterval: (query) => (query.state.data ? false : 4000), // waiting for /start → poll
  })
}

export function useTelegramLinkCode() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('telegram_link_code')
      if (error) throw error
      return data as string
    },
  })
}

export function useTelegramUnlink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('telegram_unlink')
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telegram-account'] }),
  })
}

export function useTelegramTest() {
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('telegram_send_test')
      if (error) throw error
    },
  })
}

export const telegramStartUrl = (code: string) => (TELEGRAM_BOT_USERNAME ? `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${code}` : '')
