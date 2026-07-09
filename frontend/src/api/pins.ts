import { api } from './client'
import type { PinDto } from '../types'

export const pinsApi = {
  list: (workspaceId: string) => api.get<PinDto[]>(`/workspaces/${workspaceId}/pins`),
  create: (messageId: string, questionSnapshot: string, contentSnapshot: string) =>
    api.post<PinDto>(`/messages/${messageId}/pin`, {
      question_snapshot: questionSnapshot,
      content_snapshot: contentSnapshot,
    }),
  delete: (pinId: string) => api.delete<void>(`/pins/${pinId}`),
}
