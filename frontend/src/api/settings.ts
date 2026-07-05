import { api } from './client'
import type { ModelSettingsOut } from '../types'

export interface ModelSettingsIn {
  llm_base_url?: string
  llm_api_key?: string
  llm_model?: string
  embedding_base_url?: string
  embedding_api_type: string
  embedding_model?: string
}

export const settingsApi = {
  get: () => api.get<ModelSettingsOut>('/settings/model'),
  update: (payload: ModelSettingsIn) => api.put<ModelSettingsOut>('/settings/model', payload),
  testLlm: () => api.post<{ success: boolean; message: string }>('/settings/model/test-llm'),
  testEmbedding: () => api.post<{ success: boolean; message: string }>('/settings/model/test-embedding'),
}
