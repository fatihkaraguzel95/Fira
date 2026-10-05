import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useDateFormatSync } from '../../hooks/useDateFormatPrefs'
import { ServerUnreachable } from './ServerUnreachable'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, stuck } = useAuth()
  // Every signed-in screen renders through here, so this is the one place the
  // stored date-format preference has to reach the formatters.
  useDateFormatSync()

  if (loading) {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-600 border-t-transparent" />
      </div>
    )
  }

  // Oturum okunamadı ve süre doldu (#b9e1bb66): sessiz tekerlek yerine ne
  // olduğunu ve ne zaman yeniden deneneceğini söyleyen ekran.
  if (stuck && !session) {
    return <ServerUnreachable />
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
