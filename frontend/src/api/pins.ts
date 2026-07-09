import { api } from './client'
import type { PinDto } from '../types'

export const pinsApi = {
  list: (workspaceId: string) => api.get<PinDto[]>(`/workspaces/${workspaceId}/pins`),
  create: (messageId: string, contentSnapshot: string) =>
    api.post<PinDto>(`/messages/${messageId}/pin`, { content_snapshot: contentSnapshot }),
  delete: (pinId: string) => api.delete<void>(`/pins/${pinId}`),
}
