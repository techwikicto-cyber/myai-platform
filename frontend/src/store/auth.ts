import { create } from 'zustand'
import type { User } from '../types'

interface AuthState {
  token: string | null
  user: User | null
  setSession: (token: string, user: User) => void
  logout: () => void
}

const storedToken = localStorage.getItem('bina_token')
const storedUser = localStorage.getItem('bina_user')

export const useAuthStore = create<AuthState>((set) => ({
  token: storedToken,
  user: storedUser ? (JSON.parse(storedUser) as User) : null,
  setSession: (token, user) => {
    localStorage.setItem('bina_token', token)
    localStorage.setItem('bina_user', JSON.stringify(user))
    set({ token, user })
  },
  logout: () => {
    localStorage.removeItem('bina_token')
    localStorage.removeItem('bina_user')
    set({ token: null, user: null })
  },
}))
