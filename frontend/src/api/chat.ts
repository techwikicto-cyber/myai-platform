import { api, API_BASE } from './client'
import { useAuthStore } from '../store/auth'
import type { ChatMessage } from '../types'

export interface ThreadDto {
  id: string
  workspace_id: string
  title: string
  created_at: string
  updated_at: string
}

export const chatApi = {
  listThreads: (workspaceId: string) => api.get<ThreadDto[]>(`/workspaces/${workspaceId}/threads`),
  createThread: (workspaceId: string, title?: string) =>
    api.post<ThreadDto>(`/workspaces/${workspaceId}/threads`, { title }),
  deleteThread: (threadId: string) => api.delete<void>(`/threads/${threadId}`),
  renameThread: (threadId: string, title: string) => api.patch<ThreadDto>(`/threads/${threadId}`, { title }),
  listMessages: (threadId: string) => api.get<ChatMessage[]>(`/threads/${threadId}/messages`),
}

export type StreamEvent =
  | { type: 'token'; content: string }
  | { type: 'done'; message_id: string; export_ids?: string[] }
  | { type: 'error'; message: string }

/**
 * How the backend should treat this message. Modelled on Chat2DB's QuestionType: the
 * caller states what kind of question this is rather than the model inferring it.
 *   auto  — let the model decide (default)
 *   query — must run a real database query; a prose-only reply is rejected
 *   chat  — never query; answer from documents + schema
 */
export type ChatMode = 'auto' | 'query' | 'chat'

export async function streamMessage(
  threadId: string,
  content: string,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
  mode: ChatMode = 'auto',
  tables: string[] = [],
): Promise<void> {
  const token = useAuthStore.getState().token
  const res = await fetch(`${API_BASE}/threads/${threadId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ content, mode, tables }),
    signal,
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `درخواست ناموفق (${res.status})`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data:')) continue
      const jsonStr = line.slice(5).trim()
      if (!jsonStr) continue
      try {
        onEvent(JSON.parse(jsonStr) as StreamEvent)
      } catch {
        /* ignore malformed chunk */
      }
    }
  }
}
