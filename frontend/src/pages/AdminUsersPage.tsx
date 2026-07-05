import { useEffect, useState } from 'react'
import { usersApi } from '../api/users'
import type { User, UserRole } from '../types'
import { ApiError } from '../api/client'

const roleLabels: Record<UserRole, string> = {
  admin: 'ادمین سیستم',
  manager: 'ادمین ورک‌اسپیس',
  user: 'کاربر عادی',
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('user')
  const [error, setError] = useState('')

  async function reload() {
    setUsers(await usersApi.list())
  }

  useEffect(() => {
    reload()
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await usersApi.create(email, password, role)
      setEmail('')
      setPassword('')
      setRole('user')
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطای غیرمنتظره')
    }
  }

  async function handleRoleChange(id: string, newRole: UserRole) {
    await usersApi.update(id, { role: newRole })
    await reload()
  }

  async function handleToggleActive(u: User) {
    await usersApi.update(u.id, { is_active: !u.is_active })
    await reload()
  }

  async function handleDelete(id: string) {
    if (!confirm('این کاربر حذف شود؟')) return
    await usersApi.remove(id)
    await reload()
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-8">
      <h1 className="mb-6 text-xl font-semibold text-zinc-100">مدیریت کاربران</h1>

      <form onSubmit={handleCreate} className="mb-8 flex flex-wrap items-end gap-3 rounded-xl bg-zinc-800/50 p-4">
        <div>
          <label className="mb-1 block text-xs text-zinc-400">ایمیل</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">رمز عبور</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">نقش</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          >
            <option value="user">کاربر عادی</option>
            <option value="manager">ادمین ورک‌اسپیس</option>
            <option value="admin">ادمین سیستم</option>
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
          ساخت کاربر
        </button>
        {error && <p className="w-full text-sm text-red-400">{error}</p>}
      </form>

      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-800/70 text-zinc-400">
            <tr>
              <th className="px-4 py-2 text-right">ایمیل</th>
              <th className="px-4 py-2 text-right">نقش</th>
              <th className="px-4 py-2 text-right">وضعیت</th>
              <th className="px-4 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-zinc-800">
                <td className="px-4 py-2 text-zinc-200">{u.email}</td>
                <td className="px-4 py-2">
                  <select
                    value={u.role}
                    onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                    className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
                  >
                    <option value="user">{roleLabels.user}</option>
                    <option value="manager">{roleLabels.manager}</option>
                    <option value="admin">{roleLabels.admin}</option>
                  </select>
                </td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => handleToggleActive(u)}
                    className={`rounded px-2 py-1 text-xs ${u.is_active ? 'bg-emerald-600/20 text-emerald-400' : 'bg-zinc-700 text-zinc-400'}`}
                  >
                    {u.is_active ? 'فعال' : 'غیرفعال'}
                  </button>
                </td>
                <td className="px-4 py-2 text-left">
                  <button onClick={() => handleDelete(u.id)} className="text-xs text-red-400 hover:underline">
                    حذف
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
