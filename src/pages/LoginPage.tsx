import { Navigate } from 'react-router-dom'
import { LoginForm } from '../components/auth/LoginForm'
import { useAuth } from '../hooks/useAuth'

export function LoginPage() {
  const { session, loading } = useAuth()

  if (loading) return null
  if (session) return <Navigate to="/" replace />

  return <LoginForm />
}
