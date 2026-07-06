import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { workspacesApi } from '../api/workspaces'
import { usersApi } from '../api/users'
import { documentsApi, type DocumentDto } from '../api/documents'
import DbConnectionsPanel from '../components/DbConnectionsPanel'
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Spinner, Textarea } from '../components/ui'
import { IconDatabase, IconDocument, IconSearch, IconSettings, IconTrash, IconUpload, IconUserPlus, IconUsers } from '../components/icons'
import { ApiError } from '../api/client'
import { useAuthStore } from '../store/auth'
import type { User, Workspace, WorkspaceMember } from '../types'

const statusBadge: Record<string, { kind: 'success' | 'error' | 'warning' | 'muted'; label: string }> = {
  pending: { kind: 'muted', label: 'در صف' },
  processing: { kind: 'warning', label: 'در حال پردازش' },
  ready: { kind: 'success', label: 'آماده' },
  failed: { kind: 'error', label: 'خطا' },
}

/** Scrolling ticker for long filenames */
function ScrollingName({ name }: { name: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [needsScroll, setNeedsScroll] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    const txt = textRef.current
    if (el && txt) {
      setNeedsScroll(txt.scrollWidth > el.clientWidth + 2)
    }
  }, [name])

  return (
    <div
      ref={containerRef}
      className="relative max-w-[220px] overflow-hidden"
      title={name}
    >
      <span
        ref={textRef}
        className={clsx(
          'whitespace-nowrap text-sm font-medium text-foreground inline-block',
          needsScroll && 'animate-marquee',
        )}
      >
        {name}
      </span>
    </div>
  )
}

export default function WorkspaceSettingsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const currentUser = useAuthStore((s) => s.user)
  const [tab, setTab] = useState<'general' | 'documents' | 'database' | 'members'>('general')
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [name, setName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [documents, setDocuments] = useState<DocumentDto[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Members tab state
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [userSearch, setUserSearch] = useState('')
  const [memberError, setMemberError] = useState('')
  const [memberMsg, setMemberMsg] = useState('')

  const isAdmin = currentUser?.role === 'admin'
  const isManager = currentUser?.role === 'admin' || currentUser?.role === 'manager'

  const reloadDocuments = useCallback(async () => {
    if (!workspaceId) return
    setDocuments(await documentsApi.list(workspaceId))
  }, [workspaceId])

  const reloadMembers = useCallback(async () => {
    if (!workspaceId) return
    setMembers(await workspacesApi.members(workspaceId))
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) return
    workspacesApi.get(workspaceId).then((ws) => {
      setWorkspace(ws)
      setName(ws.name)
      setSystemPrompt(ws.system_prompt || '')
    })
    reloadDocuments()
    reloadMembers()
    // Admin can load all users to search and assign
    if (isAdmin || isManager) {
      usersApi.list().then(setAllUsers).catch(() => {})
    }
  }, [workspaceId, reloadDocuments, reloadMembers, isAdmin, isManager])

  // Poll while documents are processing
  const hasInFlight = documents.some((d) => d.status === 'pending' || d.status === 'processing')
  useEffect(() => {
    if (!hasInFlight) return
    const timer = setInterval(reloadDocuments, 3000)
    return () => clearInterval(timer)
  }, [hasInFlight, reloadDocuments])

  async function handleSaveGeneral(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId) return
    setSaving(true)
    setSavedMsg('')
    try {
      await workspacesApi.update(workspaceId, { name, system_prompt: systemPrompt })
      setSavedMsg('ذخیره شد')
      setTimeout(() => setSavedMsg(''), 3000)
    } finally {
      setSaving(false)
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0 || !workspaceId) return
    setUploading(true)
    setError('')
    try {
      const results = await Promise.allSettled(files.map((f) => documentsApi.upload(workspaceId, f)))
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failures.length > 0) {
        const first = failures[0].reason
        setError(
          `${failures.length} فایل آپلود نشد` + (first instanceof ApiError ? ` — ${first.message}` : ''),
        )
      }
      await reloadDocuments()
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDeleteDoc(docId: string) {
    if (!workspaceId) return
    await documentsApi.remove(workspaceId, docId)
    await reloadDocuments()
  }

  async function handleAddMember(user: User) {
    if (!workspaceId) return
    setMemberError('')
    setMemberMsg('')
    try {
      await workspacesApi.addMember(workspaceId, user.email, false)
      setMemberMsg(`کاربر ${user.email} به فضای کاری اضافه شد`)
      setTimeout(() => setMemberMsg(''), 3000)
      await reloadMembers()
    } catch (err) {
      setMemberError(err instanceof ApiError ? err.message : 'خطا در افزودن کاربر')
    }
  }

  async function handleRemoveMember(member: WorkspaceMember) {
    if (!workspaceId) return
    if (!confirm(`کاربر ${member.email} از فضای کاری حذف شود؟`)) return
    setMemberError('')
    try {
      await workspacesApi.removeMember(workspaceId, member.user_id)
      await reloadMembers()
    } catch (err) {
      setMemberError(err instanceof ApiError ? err.message : 'خطا در حذف عضو')
    }
  }

  // Filter users not already members, matching search query
  const memberUserIds = new Set(members.map((m) => m.user_id))
  const filteredUsers = allUsers.filter(
    (u) =>
      !memberUserIds.has(u.id) &&
      (userSearch === '' || u.email.toLowerCase().includes(userSearch.toLowerCase())),
  )

  const tabs = [
    { key: 'general' as const, label: 'عمومی', icon: <IconSettings /> },
    { key: 'documents' as const, label: 'مستندات', icon: <IconDocument /> },
    { key: 'database' as const, label: 'اتصال دیتابیس', icon: <IconDatabase /> },
    ...(isManager ? [{ key: 'members' as const, label: 'اعضا', icon: <IconUsers /> }] : []),
  ]

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="border-b border-border bg-card px-6 pt-5">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-foreground">تنظیمات {workspace?.name}</h1>
          <Link to={`/workspace/${workspaceId}`} className="text-sm text-primary hover:underline">
            بازگشت به گفتگو
          </Link>
        </div>
        <div className="mt-3 flex gap-1 pb-3">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={clsx(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                tab === t.key
                  ? 'bg-primary-soft font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {tab === 'general' && (
        <div className="mx-auto w-full max-w-2xl p-6">
          <Card>
            <CardHeader title="تنظیمات عمومی" description="نام و دستورالعمل ثابت این فضای کاری" />
            <form onSubmit={handleSaveGeneral} className="space-y-4 p-6">
              <Field label="نام فضای کاری">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field
                label="دستورالعمل سیستمی (System Prompt)"
                hint="این متن در ابتدای هر گفتگو به مدل داده می‌شود و رفتار آن را تعیین می‌کند"
              >
                <Textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={6}
                  placeholder="مثلا: تو دستیار پشتیبانی شرکت ما هستی. همیشه مودب و دقیق پاسخ بده…"
                  className="resize-none"
                />
              </Field>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving && <Spinner />}
                  ذخیره
                </Button>
                {savedMsg && <Alert kind="success">{savedMsg}</Alert>}
              </div>
            </form>
          </Card>
        </div>
      )}

      {tab === 'documents' && (
        <div className="mx-auto w-full max-w-2xl p-6">
          <Card>
            <CardHeader
              title="مستندات فضای کاری"
              description="فایل‌های pdf، docx، xlsx، csv، txt و md — می‌توانید چند فایل را همزمان انتخاب کنید؛ پردازش در پس‌زمینه انجام می‌شود"
              action={
                <label
                  className={clsx(
                    'inline-flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover',
                    uploading && 'pointer-events-none opacity-50',
                  )}
                >
                  {uploading ? <Spinner /> : <IconUpload />}
                  آپلود سند
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleUpload}
                    disabled={uploading}
                    className="hidden"
                  />
                </label>
              }
            />
            <div className="p-6 pt-4">
              {error && (
                <div className="mb-4">
                  <Alert kind="error">{error}</Alert>
                </div>
              )}
              {documents.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
                  <IconDocument className="size-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">هنوز سندی آپلود نشده است</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {documents.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <IconDocument className="size-4 shrink-0 text-muted-foreground" />
                        <ScrollingName name={d.filename} />
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className={d.status === 'pending' || d.status === 'processing' ? 'animate-pulse' : ''}>
                          <Badge kind={statusBadge[d.status].kind}>{statusBadge[d.status].label}</Badge>
                        </span>
                        <Button variant="destructive" size="sm" onClick={() => handleDeleteDoc(d.id)} title="حذف سند">
                          <IconTrash />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {documents.some((d) => d.status === 'failed' && d.error_message) && (
                <div className="mt-3 space-y-2">
                  {documents
                    .filter((d) => d.status === 'failed' && d.error_message)
                    .map((d) => (
                      <Alert key={d.id} kind="error">
                        {d.filename}: {d.error_message}
                      </Alert>
                    ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {tab === 'database' && workspaceId && <DbConnectionsPanel workspaceId={workspaceId} />}

      {tab === 'members' && isManager && (
        <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
          {/* Current members list */}
          <Card>
            <CardHeader
              title="اعضای فضای کاری"
              description={`${members.length} عضو در این فضای کاری`}
            />
            <div className="p-6 pt-4">
              {memberError && (
                <div className="mb-4">
                  <Alert kind="error">{memberError}</Alert>
                </div>
              )}
              {memberMsg && (
                <div className="mb-4">
                  <Alert kind="success">{memberMsg}</Alert>
                </div>
              )}
              {members.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
                  <IconUsers className="size-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">هنوز عضوی در این فضای کاری نیست</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {members.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground" dir="ltr">{m.email}</p>
                        <p className="text-xs text-muted-foreground">{m.is_manager ? 'ادمین فضای کاری' : 'کاربر عادی'}</p>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleRemoveMember(m)}
                        title="حذف از فضای کاری"
                      >
                        <IconTrash />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {/* Add user to workspace */}
          <Card>
            <CardHeader
              title="افزودن کاربر به فضای کاری"
              description="کاربران ساخته‌شده را جستجو کنید و به این فضای کاری اضافه کنید"
            />
            <div className="p-6 pt-4">
              <div className="relative mb-4">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="جستجوی کاربر با ایمیل…"
                  className="w-full rounded-lg border border-border bg-input py-2 pr-9 pl-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
                  dir="ltr"
                />
              </div>
              {filteredUsers.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-4">
                  {userSearch ? 'کاربری با این ایمیل پیدا نشد' : 'تمام کاربران قبلاً عضو این فضای کاری هستند'}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {filteredUsers.map((u) => (
                    <li key={u.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground" dir="ltr">{u.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {u.role === 'admin' ? 'ادمین سیستم' : u.role === 'manager' ? 'ادمین فضای کاری' : 'کاربر عادی'}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleAddMember(u)}
                      >
                        <IconUserPlus />
                        افزودن
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
