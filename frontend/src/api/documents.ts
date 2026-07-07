import { api } from './client'

export type DocumentStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface DocumentDto {
  id: string
  filename: string
  source_type: string
  status: DocumentStatus
  error_message: string | null
  shared_workspace_ids: string[]
  created_at: string
}

export interface SharedDocumentDto {
  id: string
  filename: string
  source_type: string
  status: DocumentStatus
  error_message: string | null
  source_workspace_name: string
  created_at: string
}

export const documentsApi = {
  list: (workspaceId: string) => api.get<DocumentDto[]>(`/workspaces/${workspaceId}/documents`),
  listShared: (workspaceId: string) => api.get<SharedDocumentDto[]>(`/workspaces/${workspaceId}/documents/shared`),
  upload: (workspaceId: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.upload<DocumentDto>(`/workspaces/${workspaceId}/documents`, formData)
  },
  remove: (workspaceId: string, documentId: string) =>
    api.delete<void>(`/workspaces/${workspaceId}/documents/${documentId}`),
  setShared: (workspaceId: string, documentId: string, workspaceIds: string[]) =>
    api.patch<DocumentDto>(`/workspaces/${workspaceId}/documents/${documentId}/share`, {
      workspace_ids: workspaceIds,
    }),
}
