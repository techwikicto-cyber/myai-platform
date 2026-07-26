import { api } from './client'

export interface QueryHistoryItem {
  id: string
  raw_query: string
  executed_query: string | null
  status: 'success' | 'rejected' | 'error'
  error_message: string | null
  row_count: number | null
  duration_ms: number | null
  created_at: string
  connection_name: string | null
  user_email: string | null
  /** Whether the assistant ran it on the user's behalf, or the user typed it in the console. */
  source: 'assistant' | 'console'
}

export const historyApi = {
  list: (workspaceId: string, limit = 100) =>
    api.get<QueryHistoryItem[]>(`/workspaces/${workspaceId}/query-history?limit=${limit}`),
}
