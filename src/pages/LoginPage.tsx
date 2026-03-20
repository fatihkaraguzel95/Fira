import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { LoginForm } from '../components/auth/LoginForm'
import { useAuth } from '../hooks/useAuth'

export function LoginPage() {
  const { session, loading } = useAuth()
  const [changeMode, setChangeMode] = useState(false)

  if (loading) return null
  if (session && !changeMode) return <Navigate to="/" replace />

  return <LoginForm changeMode={changeMode} onChangeModeToggle={setChangeMode} />
}
