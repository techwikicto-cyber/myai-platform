import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { workspacesApi } from '../api/workspaces'
import { useAuthStore } from '../store/auth'
import type { Workspace } from '../types'
import { IconChat, IconChevronDown, IconLogout, IconPlus, IconSettings, IconSparkles } from './icons'

const roleLabels: Record<string, string> = {
  admin: 'ادمین سیستم',
  manager: 'ادمین فضای کاری',
  user: 'کاربر',
}

export default function Sidebar() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [wsOpen, setWsOpen] = useState(true)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  async function reload() {
    const data = await workspacesApi.list()
    setWorkspaces(data)
  }

  useEffect(() => {
    reload()
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    const workspace = await workspacesApi.create(newName.trim())
    setNewName('')
    setCreating(false)
    await reload()
    navigate(`/workspace/${workspace.id}`)
  }

  const canCreateWorkspace = user?.role === 'admin' || user?.role === 'manager'

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    clsx(
      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
      isActive
        ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
        : 'text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
    )

  return (
    <aside className="flex h-full w-64 flex-shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <IconSparkles />
        </div>
        <span className="text-base font-bold">MyAI Platform</span>
      </div>

      <div className="mx-4 border-t border-sidebar-border" />

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {/* Section header — clickable to collapse */}
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

        {/* Collapsible workspace list */}
        <div
          className={clsx(
            'overflow-hidden transition-all duration-200',
            wsOpen ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0',
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
              <NavLink key={w.id} to={`/workspace/${w.id}`} className={navItemClass}>
                <IconChat />
                <span className="truncate">{w.name}</span>
              </NavLink>
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
        <div className="mt-1 flex items-center justify-between gap-2 rounded-lg px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-sidebar-foreground" dir="ltr">
              {user?.email}
            </p>
            <p className="text-[11px] text-sidebar-muted">{user ? roleLabels[user.role] : ''}</p>
          </div>
          <button
            onClick={logout}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-red-400"
            title="خروج"
          >
            <IconLogout />
          </button>
        </div>
      </div>
    </aside>
  )
}
