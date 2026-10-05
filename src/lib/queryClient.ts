import { QueryClient, MutationCache } from '@tanstack/react-query'
import { emitError } from './errorToast'

export const queryClient = new QueryClient({
  // Every failed user action (a mutation) explains itself with a toast, unless
  // the caller opted out (meta.silent) to handle the error inline — e.g. an
  // edit conflict resolved in place rather than shouted about.
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.meta?.silent) return
      emitError(error)
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // Realtime (useRealtimeSync) invalidates on change; this is only a fallback
      // A rate-limited request must not be retried: every retry keeps the
      // shared office bucket saturated and turns one 429 into a storm.
      retry: (failureCount, error) => {
        const s = `${(error as { code?: string })?.code ?? ''} ${(error as Error)?.message ?? error}`
        if (/429|Too Many|rate limit/i.test(s)) return false
        return failureCount < 1
      },
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,
    },
  },
})
