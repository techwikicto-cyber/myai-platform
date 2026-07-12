import { useEffect, useState } from 'react'
import { NavLink, useMatch, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { chatApi } from '../api/chat'
import { workspacesApi } from '../api/workspaces'
import { useAuthStore } from '../store/auth'
import { useThreadStore } from '../store/threads'
import { useWorkspaceStore } from '../store/workspaces'
import type { ThreadDto } from '../api/chat'
import {
  IconChat,
  IconChevronDown,
  IconEdit,
  IconLogout,
  IconPlus,
  IconSettings,
  IconX,
} from './icons'
import OwlLogo from './Logo'
import ProfileModal from './ProfileModal'

const roleLabels: Record<string, string> = {
  admin: 'ادمین سیستم',
  manager: 'ادمین فضای کاری',
  user: 'کاربر',
}

export default function Sidebar() {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const reloadWorkspaces = useWorkspaceStore((s) => s.reload)
  const upsertWorkspace = useWorkspaceStore((s) => s.upsert)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [wsOpen, setWsOpen] = useState(true)
  const [deletingThread, setDeletingThread] = useState<string | null>(null)
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [showProfileModal, setShowProfileModal] = useState(false)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  const threadStore = useThreadStore()

  // Detect active workspace from URL
  const wsMatch = useMatch('/workspace/:workspaceId/*')
  const threadMatch = useMatch('/workspace/:workspaceId/thread/:threadId')
  const activeWorkspaceId = wsMatch?.params.workspaceId ?? null
  const activeThreadId = threadMatch?.params.threadId ?? null

  const threads: ThreadDto[] = activeWorkspaceId ? (threadStore.threadsByWs[activeWorkspaceId] || []) : []

  useEffect(() => {
    reloadWorkspaces()
  }, [reloadWorkspaces])

  // Fetch threads when active workspace changes
  useEffect(() => {
    if (!activeWorkspaceId) return
    chatApi.listThreads(activeWorkspaceId).then((ts) => {
      threadStore.setThreads(activeWorkspaceId, ts)
    })
  }, [activeWorkspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    const workspace = await workspacesApi.create(newName.trim())
    setNewName('')
    setCreating(false)
    upsertWorkspace(workspace)
    navigate(`/workspace/${workspace.id}`)
  }

  async function handleNewThread() {
    if (!activeWorkspaceId) return
    const t = await chatApi.createThread(activeWorkspaceId)
    threadStore.upsertThread(activeWorkspaceId, t)
    navigate(`/workspace/${activeWorkspaceId}/thread/${t.id}`)
  }

  function startRename(t: ThreadDto, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setRenamingThreadId(t.id)
    setRenameValue(t.title)
  }

  async function commitRename() {
    if (!activeWorkspaceId || !renamingThreadId) return
    const title = renameValue.trim()
    const threadId = renamingThreadId
    setRenamingThreadId(null)
    if (!title) return
    const current = threads.find((t) => t.id === threadId)
    if (current && current.title === title) return
    try {
      const updated = await chatApi.renameThread(threadId, title)
      threadStore.upsertThread(activeWorkspaceId, updated)
    } catch {
      /* rename failed silently — title stays as-is */
    }
  }

  async function handleDeleteThread(threadId: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!activeWorkspaceId) return
    setDeletingThread(threadId)
    try {
      await chatApi.deleteThread(threadId)
      threadStore.removeThread(activeWorkspaceId, threadId)
      if (activeThreadId === threadId) {
        const remaining = threads.filter((t) => t.id !== threadId)
        if (remaining.length > 0) {
          navigate(`/workspace/${activeWorkspaceId}/thread/${remaining[0].id}`)
        } else {
          navigate(`/workspace/${activeWorkspaceId}`)
        }
      }
    } finally {
      setDeletingThread(null)
    }
  }

  const canCreateWorkspace = user?.role === 'admin' || user?.role === 'manager'

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    clsx(
      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
      isActive
        ? 'bg-sidebar-primary-bg font-semibold text-sidebar-primary ring-1 ring-inset ring-sidebar-primary/20'
        : 'text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
    )

  return (
    <aside className="flex h-full w-64 flex-shrink-0 flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        <OwlLogo className="size-9 shrink-0" />
        <span className="text-base font-bold">پلتفرم بینا</span>
      </div>

      <div className="mx-4 border-t border-sidebar-border" />

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {/* Section header */}
        <div
          className="mb-1 flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-sidebar-accent/40"
          onClick={() => setWsOpen((v) => !v)}
        >
          <div className="flex items-center gap-1.5">
            <IconChevronDown
              className={clsx(
                'size-3.5 text-sidebar-muted transition-transform duration-200',
                !wsOpen && '-rotate-90',
              )}
            />
            <span className="text-xs font-medium text-sidebar-muted">فضاهای کاری</span>
          </div>
          {canCreateWorkspace && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setWsOpen(true)
                setCreating((v) => !v)
              }}
              className="flex size-5 items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              title="فضای کاری جدید"
            >
              <IconPlus />
            </button>
          )}
        </div>

        {/* Workspace list */}
        <div
          className={clsx(
            'overflow-hidden transition-all duration-200',
            wsOpen ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0',
          )}
        >
          {creating && (
            <form onSubmit={handleCreate} className="mb-2 px-1">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
                placeholder="نام فضای کاری + Enter"
                className="w-full rounded-lg border border-sidebar-border bg-sidebar-accent px-3 py-2 text-sm text-sidebar-foreground outline-none placeholder:text-sidebar-muted/70 focus:border-primary"
              />
            </form>
          )}

          <nav className="flex flex-col gap-0.5">
            {workspaces.map((w) => (
              <div key={w.id}>
                <NavLink
                  to={`/workspace/${w.id}`}
                  end={false}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-sidebar-primary-bg font-semibold text-sidebar-primary ring-1 ring-inset ring-sidebar-primary/20'
                        : 'text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                    )
                  }
                >
                  <IconChat />
                  <span className="truncate">{w.name}</span>
                </NavLink>

                {/* Thread list for active workspace */}
                {activeWorkspaceId === w.id && threads.length > 0 && (
                  <div className="mb-1 mt-0.5 mr-3 border-r border-sidebar-border/50 pr-1">
                    {/* New thread button */}
                    <button
                      onClick={handleNewThread}
                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-sidebar-muted transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                    >
                      <IconPlus className="size-3" />
                      گفتگوی جدید
                    </button>

                    {threads.map((t) => (
                      <div
                        key={t.id}
                        className={clsx(
                          'group flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
                          activeThreadId === t.id
                            ? 'bg-sidebar-accent text-sidebar-foreground font-medium'
                            : 'text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                        )}
                      >
                        {renamingThreadId === t.id ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                commitRename()
                              } else if (e.key === 'Escape') {
                                setRenamingThreadId(null)
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="min-w-0 flex-1 rounded border border-primary/40 bg-sidebar-accent px-1 py-0.5 text-xs text-sidebar-foreground outline-none"
                          />
                        ) : (
                          <NavLink
                            to={`/workspace/${w.id}/thread/${t.id}`}
                            className="flex min-w-0 flex-1 items-center gap-1.5"
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => startRename(t, e)}
                          >
                            <span className="truncate">{t.title}</span>
                          </NavLink>
                        )}
                        {renamingThreadId !== t.id && (
                          <>
                            <button
                              onClick={(e) => startRename(t, e)}
                              className="shrink-0 rounded p-0.5 text-sidebar-muted/50 opacity-0 transition-all hover:text-sidebar-foreground group-hover:opacity-100"
                              title="تغییر نام گفتگو"
                            >
                              <IconEdit className="size-3" />
                            </button>
                            <button
                              onClick={(e) => handleDeleteThread(t.id, e)}
                              disabled={deletingThread === t.id}
                              className="shrink-0 rounded p-0.5 text-sidebar-muted/50 opacity-0 transition-all hover:text-destructive group-hover:opacity-100 disabled:opacity-50"
                              title="حذف گفتگو"
                            >
                              <IconX className="size-3" />
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Empty state + new thread for active workspace with no threads */}
                {activeWorkspaceId === w.id && threads.length === 0 && (
                  <div className="mr-3 border-r border-sidebar-border/50 pr-1">
                    <button
                      onClick={handleNewThread}
                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-sidebar-muted transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                    >
                      <IconPlus className="size-3" />
                      گفتگوی جدید
                    </button>
                  </div>
                )}
              </div>
            ))}
            {workspaces.length === 0 && !creating && (
              <p className="px-2 py-4 text-center text-xs text-sidebar-muted">
                {canCreateWorkspace ? 'با دکمه + یک فضای کاری بسازید' : 'هنوز به فضای کاری‌ای دعوت نشده‌اید'}
              </p>
            )}
          </nav>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-3">
        {user?.role === 'admin' && (
          <NavLink to="/admin/users" className={navItemClass}>
            <IconSettings />
            پنل مدیریت
          </NavLink>
        )}
        <div className="mt-1 flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-sidebar-accent/50 transition-colors">
          <button 
            className="flex min-w-0 items-center gap-2.5 flex-1 text-right"
            onClick={() => setShowProfileModal(true)}
            title="تنظیمات پروفایل"
          >
            {user?.profile_picture ? (
              <img src={user.profile_picture} alt="Avatar" className="size-8 rounded-full object-cover shrink-0 border border-white/10" />
            ) : (
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary font-bold text-xs uppercase border border-primary/20">
                {user?.email?.[0] || 'U'}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-sidebar-foreground">
                {user?.full_name || user?.email}
              </p>
              <p className="text-[10px] text-sidebar-muted">{user ? roleLabels[user.role] : ''}</p>
            </div>
          </button>
          <button
            onClick={logout}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-destructive"
            title="خروج"
          >
            <IconLogout />
          </button>
        </div>
      </div>
      
      {showProfileModal && <ProfileModal onClose={() => setShowProfileModal(false)} />}
    </aside>
  )
}
