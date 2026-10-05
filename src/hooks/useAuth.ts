import { useEffect, useState } from 'react'
import { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'

/**
 * İlk oturum okuması bu kadar sürerse "takıldı" sayılır (#b9e1bb66). Ofis ağına
 * bağlı değilken istek düşmüyor, zaman aşımını bekliyor: `getSession()` kayıtlı
 * belirteci yenilemeye çalışıp dakikalarca dönüyor ve ekranda yalnız bir tekerlek
 * kalıyordu. Süre dolunca kontrol geri alınır, ekran ne olduğunu söyler.
 */
const BOOT_TIMEOUT_MS = 6000

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  /** İlk okuma zaman aşımına uğradı ve hâlâ oturum yok. */
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    let settled = false
    const apply = (s: Session | null) => {
      settled = true
      setStuck(false)
      setSession(s)
      setUser(s?.user ?? null)
      setLoading(false)
    }
    const timer = window.setTimeout(() => {
      if (settled) return
      setStuck(true)
      setLoading(false)
    }, BOOT_TIMEOUT_MS)

    supabase.auth.getSession().then(({ data: { session } }) => {
      window.clearTimeout(timer)
      apply(session)
    }, () => {
      window.clearTimeout(timer)
      setStuck(true)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        queryClient.clear()
      }
      window.clearTimeout(timer)
      apply(session)
    })

    return () => { window.clearTimeout(timer); subscription.unsubscribe() }
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    })
    if (error) throw error
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  return { session, user, loading, stuck, signIn, signUp, signOut }
}
