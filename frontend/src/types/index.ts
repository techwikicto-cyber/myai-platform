export type UserRole = 'admin' | 'manager' | 'user'

export interface User {
  id: string
  email: string
  role: UserRole
  is_active: boolean
  must_change_password?: boolean
  full_name?: string | null
  profile_picture?: string | null
}

export type AnswerMode = 'strict' | 'open'

export interface Workspace {
  id: string
  name: string
  slug: string
  system_prompt: string | null
  answer_mode: AnswerMode
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
  reviewer_llm_base_url: string | null
  reviewer_llm_model: string | null
  reviewer_llm_api_key_set: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at?: string
  pending?: boolean
  export_ids?: string[]
}

export interface PinDto {
  id: string
  message_id: string
  workspace_id: string
  question_snapshot: string
  content_snapshot: string
  created_at: string
}
