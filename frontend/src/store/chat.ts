import { create } from 'zustand'
import type { ChatMode } from '../api/chat'
import type { ChatMessage } from '../types'

interface ChatState {
  // Keyed by threadId
  messages: Record<string, ChatMessage[]>
  input: Record<string, string>
  sending: Record<string, boolean>
  error: Record<string, string>
  mode: Record<string, ChatMode>

  setMessages: (threadId: string, msgs: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
  setInput: (threadId: string, text: string) => void
  setSending: (threadId: string, isSending: boolean) => void
  setError: (threadId: string, msg: string) => void
  setMode: (threadId: string, mode: ChatMode) => void
}

export const useChatStore = create<ChatState>((set) => ({
  messages: {},
  input: {},
  sending: {},
  error: {},
  mode: {},

  setMessages: (threadId, updater) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [threadId]: typeof updater === 'function' ? updater(s.messages[threadId] || []) : updater,
      },
    })),
  setInput: (threadId, text) =>
    set((s) => ({ input: { ...s.input, [threadId]: text } })),
  setSending: (threadId, isSending) =>
    set((s) => ({ sending: { ...s.sending, [threadId]: isSending } })),
  setError: (threadId, msg) =>
    set((s) => ({ error: { ...s.error, [threadId]: msg } })),
  setMode: (threadId, mode) =>
    set((s) => ({ mode: { ...s.mode, [threadId]: mode } })),
}))
