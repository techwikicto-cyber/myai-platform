import { api } from './client'
import type { User } from '../types'

export interface TokenResponse {
  access_token: string
  token_type: string
  user: User
}

export const authApi = {
  status: () => api.get<{ needs_onboarding: boolean }>('/auth/status'),
  onboarding: (email: string, password: string) =>
    api.post<TokenResponse>('/auth/onboarding', { email, password }),
  login: (email: string, password: string) => api.post<TokenResponse>('/auth/login', { email, password }),
  me: () => api.get<User>('/auth/me'),
}
