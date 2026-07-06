import { useEffect, useState } from 'react'
import { usersApi } from '../api/users'
import type { User, UserRole } from '../types'
import { ApiError } from '../api/client'
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select } from '../components/ui'
import { IconTrash } from '../components/icons'

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
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <Card>
        <CardHeader title="افزودن کاربر" description="کاربر جدید با ایمیل و رمز عبور بسازید و نقشش را تعیین کنید" />
        <form onSubmit={handleCreate} className="p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="ایمیل">
              <Input type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="رمز عبور">
              <Input type="password" dir="ltr" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="نقش">
              <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                <option value="user">{roleLabels.user}</option>
                <option value="manager">{roleLabels.manager}</option>
                <option value="admin">{roleLabels.admin}</option>
              </Select>
            </Field>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button type="submit">ساخت کاربر</Button>
            {error && <Alert kind="error">{error}</Alert>}
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="کاربران" description={`${users.length} کاربر ثبت شده`} />
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-6 py-3 text-right font-medium">ایمیل</th>
              <th className="px-6 py-3 text-right font-medium">نقش</th>
              <th className="px-6 py-3 text-right font-medium">وضعیت</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                <td className="px-6 py-3 font-medium text-foreground" dir="ltr">
                  {u.email}
                </td>
                <td className="px-6 py-3">
                  <Select
                    className="h-8 w-44 text-xs"
                    value={u.role}
                    onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                  >
                    <option value="user">{roleLabels.user}</option>
                    <option value="manager">{roleLabels.manager}</option>
                    <option value="admin">{roleLabels.admin}</option>
                  </Select>
                </td>
                <td className="px-6 py-3">
                  <button onClick={() => handleToggleActive(u)} title="برای تغییر وضعیت کلیک کنید">
                    <Badge kind={u.is_active ? 'success' : 'muted'}>{u.is_active ? 'فعال' : 'غیرفعال'}</Badge>
                  </button>
                </td>
                <td className="px-6 py-3 text-left">
                  <Button variant="destructive" size="sm" onClick={() => handleDelete(u.id)} title="حذف کاربر">
                    <IconTrash />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
