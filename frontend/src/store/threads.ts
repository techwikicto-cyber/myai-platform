import { create } from 'zustand'
import type { ThreadDto } from '../api/chat'

interface ThreadStore {
  threadsByWs: Record<string, ThreadDto[]>
  setThreads: (wsId: string, threads: ThreadDto[]) => void
  upsertThread: (wsId: string, thread: ThreadDto) => void
  removeThread: (wsId: string, threadId: string) => void
}

export const useThreadStore = create<ThreadStore>((set) => ({
  threadsByWs: {},
  setThreads: (wsId, threads) =>
    set((s) => ({ threadsByWs: { ...s.threadsByWs, [wsId]: threads } })),
  upsertThread: (wsId, thread) =>
    set((s) => {
      const cur = s.threadsByWs[wsId] || []
      const idx = cur.findIndex((t) => t.id === thread.id)
      const next =
        idx >= 0 ? cur.map((t) => (t.id === thread.id ? { ...t, ...thread } : t)) : [thread, ...cur]
      return { threadsByWs: { ...s.threadsByWs, [wsId]: next } }
    }),
  removeThread: (wsId, threadId) =>
    set((s) => ({
      threadsByWs: {
        ...s.threadsByWs,
        [wsId]: (s.threadsByWs[wsId] || []).filter((t) => t.id !== threadId),
      },
    })),
}))
