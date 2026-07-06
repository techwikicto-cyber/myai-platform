import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { workspacesApi } from '../api/workspaces'
import { documentsApi, type DocumentDto } from '../api/documents'
import DbConnectionsPanel from '../components/DbConnectionsPanel'
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Spinner, Textarea } from '../components/ui'
import { IconDatabase, IconDocument, IconSettings, IconTrash, IconUpload } from '../components/icons'
import { ApiError } from '../api/client'
import type { Workspace } from '../types'

const statusBadge: Record<string, { kind: 'success' | 'error' | 'warning' | 'muted'; label: string }> = {
  pending: { kind: 'muted', label: 'در صف' },
  processing: { kind: 'warning', label: 'در حال پردازش' },
  ready: { kind: 'success', label: 'آماده' },
  failed: { kind: 'error', label: 'خطا' },
}

export default function WorkspaceSettingsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [tab, setTab] = useState<'general' | 'documents' | 'database'>('general')
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [name, setName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [documents, setDocuments] = useState<DocumentDto[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reloadDocuments = useCallback(async () => {
    if (!workspaceId) return
    setDocuments(await documentsApi.list(workspaceId))
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) return
    workspacesApi.get(workspaceId).then((ws) => {
      setWorkspace(ws)
      setName(ws.name)
      setSystemPrompt(ws.system_prompt || '')
    })
    reloadDocuments()
  }, [workspaceId, reloadDocuments])

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
    const file = e.target.files?.[0]
    if (!file || !workspaceId) return
    setUploading(true)
    setError('')
    try {
      await documentsApi.upload(workspaceId, file)
      await reloadDocuments()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در آپلود فایل')
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

  const tabs = [
    { key: 'general' as const, label: 'عمومی', icon: <IconSettings /> },
    { key: 'documents' as const, label: 'مستندات', icon: <IconDocument /> },
    { key: 'database' as const, label: 'اتصال دیتابیس', icon: <IconDatabase /> },
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
            <CardHeader title="تنظیمات عمومی" description="نام و دستورالعمل ثابت این ورک‌اسپیس" />
            <form onSubmit={handleSaveGeneral} className="space-y-4 p-6">
              <Field label="نام ورک‌اسپیس">
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
              title="مستندات ورک‌اسپیس"
              description="فایل‌های pdf، docx، xlsx، csv، txt و md — بعد از پردازش، چت بر اساس محتوای آن‌ها پاسخ می‌دهد"
              action={
                <label
                  className={clsx(
                    'inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover',
                    uploading && 'pointer-events-none opacity-50',
                  )}
                >
                  {uploading ? <Spinner /> : <IconUpload />}
                  آپلود سند
                  <input ref={fileInputRef} type="file" onChange={handleUpload} disabled={uploading} className="hidden" />
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
                        <IconDocument className="text-muted-foreground" />
                        <span className="truncate text-sm font-medium text-foreground">{d.filename}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <Badge kind={statusBadge[d.status].kind}>{statusBadge[d.status].label}</Badge>
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
    </div>
  )
}
