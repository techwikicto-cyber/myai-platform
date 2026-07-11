import { api } from './client'
import type { AnswerMode, Workspace, WorkspaceMember } from '../types'

export const workspacesApi = {
  list: () => api.get<Workspace[]>('/workspaces'),
  create: (name: string) => api.post<Workspace>('/workspaces', { name }),
  get: (id: string) => api.get<Workspace>(`/workspaces/${id}`),
  update: (id: string, payload: { name?: string; system_prompt?: string; answer_mode?: AnswerMode }) =>
    api.patch<Workspace>(`/workspaces/${id}`, payload),
  remove: (id: string) => api.delete<void>(`/workspaces/${id}`),
  members: (id: string) => api.get<WorkspaceMember[]>(`/workspaces/${id}/members`),
  addMember: (id: string, email: string, is_manager: boolean) =>
    api.post<WorkspaceMember>(`/workspaces/${id}/members`, { email, is_manager }),
  removeMember: (id: string, userId: string) => api.delete<void>(`/workspaces/${id}/members/${userId}`),
}
