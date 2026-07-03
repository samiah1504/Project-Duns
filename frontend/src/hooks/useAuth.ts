import { useState, useEffect, createContext, useContext } from 'react'
import { User } from '../types'
import { getMe } from '../services/api'

interface AuthCtx {
  user: User | null
  loading: boolean
  setUser: (u: User | null) => void
  logout: () => void
}

export const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  setUser: () => {},
  logout: () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

export function useHasModule(module: string): boolean {
  const { user } = useContext(AuthContext)
  if (!user) return false
  return (user.effective_modules ?? []).includes(module)
}

export function useAuthProvider() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) { setLoading(false); return }
    getMe()
      .then((r) => setUser(r.data))
      .catch(() => localStorage.removeItem('access_token'))
      .finally(() => setLoading(false))
  }, [])

  const logout = () => {
    localStorage.removeItem('access_token')
    setUser(null)
  }

  return { user, loading, setUser, logout }
}
