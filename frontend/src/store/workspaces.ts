import { create } from 'zustand'
import { workspacesApi } from '../api/workspaces'
import type { Workspace } from '../types'

interface WorkspaceStore {
  workspaces: Workspace[]
  setWorkspaces: (ws: Workspace[]) => void
  reload: () => Promise<void>
  upsert: (ws: Workspace) => void
  remove: (id: string) => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  workspaces: [],
  setWorkspaces: (workspaces) => set({ workspaces }),
  reload: async () => {
    const data = await workspacesApi.list()
    set({ workspaces: data })
  },
  upsert: (ws) =>
    set((s) => {
      const idx = s.workspaces.findIndex((w) => w.id === ws.id)
      return {
        workspaces: idx >= 0 ? s.workspaces.map((w) => (w.id === ws.id ? ws : w)) : [...s.workspaces, ws],
      }
    }),
  remove: (id) => set((s) => ({ workspaces: s.workspaces.filter((w) => w.id !== id) })),
}))
