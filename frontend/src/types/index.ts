export type UserRole = 'admin' | 'manager' | 'user'

export interface User {
  id: string
  email: string
  role: UserRole
  is_active: boolean
}

export interface Workspace {
  id: string
  name: string
  slug: string
  system_prompt: string | null
  created_at: string
  is_manager: boolean
}

export interface WorkspaceMember {
  id: string
  user_id: string
  email: string
  is_manager: boolean
}

export interface ModelSettingsOut {
  llm_base_url: string | null
  llm_model: string | null
  llm_api_key_set: boolean
  embedding_base_url: string | null
  embedding_api_type: string
  embedding_model: string | null
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at?: string
  pending?: boolean
}

export interface PinDto {
  id: string
  message_id: string
  workspace_id: string
  content_snapshot: string
  created_at: string
}
