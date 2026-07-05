import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { workspacesApi } from '../api/workspaces'
import { useAuthStore } from '../store/auth'
import type { Workspace } from '../types'

export default function Sidebar() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
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

  return (
    <aside className="flex h-full w-64 flex-shrink-0 flex-col border-e border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between px-4 py-4">
        <span className="text-lg font-semibold text-zinc-100">MyAI Platform</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">ورک‌اسپیس‌ها</span>
          {canCreateWorkspace && (
            <button
              onClick={() => setCreating((v) => !v)}
              className="rounded px-1.5 py-0.5 text-lg leading-none text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              title="ورک‌اسپیس جدید"
            >
              +
            </button>
          )}
        </div>

        {creating && (
          <form onSubmit={handleCreate} className="mb-2 px-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="نام ورک‌اسپیس"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            />
          </form>
        )}

        <nav className="flex flex-col gap-0.5">
          {workspaces.map((w) => (
            <NavLink
              key={w.id}
              to={`/workspace/${w.id}`}
              className={({ isActive }) =>
                `truncate rounded-lg px-3 py-2 text-sm ${
                  isActive ? 'bg-indigo-600/20 text-indigo-300' : 'text-zinc-300 hover:bg-zinc-800'
                }`
              }
            >
              {w.name}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="border-t border-zinc-800 px-3 py-3">
        {user?.role === 'admin' && (
          <NavLink
            to="/admin/users"
            className={({ isActive }) =>
              `mb-1 block rounded-lg px-3 py-2 text-sm ${
                isActive ? 'bg-indigo-600/20 text-indigo-300' : 'text-zinc-300 hover:bg-zinc-800'
              }`
            }
          >
            پنل مدیریت
          </NavLink>
        )}
        <div className="flex items-center justify-between px-3 py-1">
          <div className="truncate text-xs text-zinc-400">{user?.email}</div>
          <button onClick={logout} className="text-xs text-zinc-500 hover:text-red-400">
            خروج
          </button>
        </div>
      </div>
    </aside>
  )
}
