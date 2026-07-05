import { api } from './client'
import type { User, UserRole } from '../types'

export const usersApi = {
  list: () => api.get<User[]>('/users'),
  create: (email: string, password: string, role: UserRole) =>
    api.post<User>('/users', { email, password, role }),
  update: (id: string, payload: { role?: UserRole; is_active?: boolean; password?: string }) =>
    api.patch<User>(`/users/${id}`, payload),
  remove: (id: string) => api.delete<void>(`/users/${id}`),
}
