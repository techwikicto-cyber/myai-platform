import { create } from 'zustand'
import type { User } from '../types'

interface AuthState {
  token: string | null
  user: User | null
  setSession: (token: string, user: User) => void
  logout: () => void
}

const storedToken = localStorage.getItem('myai_token')
const storedUser = localStorage.getItem('myai_user')

export const useAuthStore = create<AuthState>((set) => ({
  token: storedToken,
  user: storedUser ? (JSON.parse(storedUser) as User) : null,
  setSession: (token, user) => {
    localStorage.setItem('myai_token', token)
    localStorage.setItem('myai_user', JSON.stringify(user))
    set({ token, user })
  },
  logout: () => {
    localStorage.removeItem('myai_token')
    localStorage.removeItem('myai_user')
    set({ token: null, user: null })
  },
}))
