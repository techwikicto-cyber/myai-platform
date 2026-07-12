import { api } from './client'
import type { User, UserRole } from '../types'

export const usersApi = {
  list: () => api.get<User[]>('/users'),
  create: (email: string, password: string, role: UserRole) =>
    api.post<User>('/users', { email, password, role }),
  update: (id: string, payload: { role?: UserRole; is_active?: boolean; password?: string }) =>
    api.patch<User>(`/users/${id}`, payload),
  remove: (id: string) => api.delete<void>(`/users/${id}`),
  updateProfile: (payload: { full_name?: string | null; profile_picture?: string | null }) =>
    api.patch<User>('/users/me', payload),
  changePassword: (payload: { current_password: string; new_password: string }) =>
    api.post<User>('/users/me/password', payload),
}
