import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { workspacesApi } from '../api/workspaces'
import { documentsApi, type DocumentDto } from '../api/documents'
import DbConnectionsPanel from '../components/DbConnectionsPanel'
import type { Workspace } from '../types'
import { ApiError } from '../api/client'

const statusLabels: Record<string, string> = {
  pending: 'در صف',
  processing: 'در حال پردازش',
  ready: 'آماده',
  failed: 'خطا',
}

const statusColors: Record<string, string> = {
  pending: 'text-zinc-400',
  processing: 'text-amber-400',
  ready: 'text-emerald-400',
  failed: 'text-red-400',
}

export default function WorkspaceSettingsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'general' | 'documents' | 'database'>('general')
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [name, setName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [documents, setDocuments] = useState<DocumentDto[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function reloadDocuments() {
    if (!workspaceId) return
    setDocuments(await documentsApi.list(workspaceId))
  }

  useEffect(() => {
    if (!workspaceId) return
    workspacesApi.get(workspaceId).then((ws) => {
      setWorkspace(ws)
      setName(ws.name)
      setSystemPrompt(ws.system_prompt || '')
    })
    reloadDocuments()
  }, [workspaceId])

  async function handleSaveGeneral(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId) return
    setSaving(true)
    try {
      await workspacesApi.update(workspaceId, { name, system_prompt: systemPrompt })
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

  const tabClass = (t: string) =>
    `rounded-lg px-3 py-1.5 text-sm ${tab === t ? 'bg-indigo-600/20 text-indigo-300' : 'text-zinc-400 hover:bg-zinc-800'}`

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-6 py-3">
        <button onClick={() => navigate(`/workspace/${workspaceId}`)} className="text-sm text-zinc-400 hover:text-zinc-200">
          ← بازگشت به چت
        </button>
        <span className="mx-2 text-zinc-600">|</span>
        <h2 className="text-sm font-medium text-zinc-200">تنظیمات {workspace?.name}</h2>
      </div>

      <div className="flex gap-2 border-b border-zinc-800 px-6 py-2">
        <button onClick={() => setTab('general')} className={tabClass('general')}>
          عمومی
        </button>
        <button onClick={() => setTab('documents')} className={tabClass('documents')}>
          مستندات
        </button>
        <button onClick={() => setTab('database')} className={tabClass('database')}>
          اتصال دیتابیس
        </button>
      </div>

      {tab === 'general' && (
        <form onSubmit={handleSaveGeneral} className="mx-auto w-full max-w-xl space-y-4 p-6">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">نام ورک‌اسپیس</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">دستورالعمل سیستمی (System Prompt)</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={6}
              placeholder="مثلا: تو دستیار پشتیبانی شرکت آکمه هستی..."
              className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? 'در حال ذخیره...' : 'ذخیره'}
          </button>
        </form>
      )}

      {tab === 'documents' && (
        <div className="mx-auto w-full max-w-2xl p-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-zinc-400">فایل‌های pdf، docx، xlsx، csv، txt و md پشتیبانی می‌شوند.</p>
            <label className="cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
              {uploading ? 'در حال آپلود...' : 'آپلود سند'}
              <input ref={fileInputRef} type="file" onChange={handleUpload} disabled={uploading} className="hidden" />
            </label>
          </div>
          {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-800/70 text-zinc-400">
                <tr>
                  <th className="px-4 py-2 text-right">نام فایل</th>
                  <th className="px-4 py-2 text-right">وضعیت</th>
                  <th className="px-4 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id} className="border-t border-zinc-800">
                    <td className="px-4 py-2 text-zinc-200">{d.filename}</td>
                    <td className={`px-4 py-2 ${statusColors[d.status]}`}>
                      {statusLabels[d.status]}
                      {d.status === 'failed' && d.error_message && (
                        <span className="mr-2 text-xs text-zinc-500">({d.error_message})</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-left">
                      <button onClick={() => handleDeleteDoc(d.id)} className="text-xs text-red-400 hover:underline">
                        حذف
                      </button>
                    </td>
                  </tr>
                ))}
                {documents.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-zinc-500">
                      هنوز سندی آپلود نشده است
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'database' && workspaceId && <DbConnectionsPanel workspaceId={workspaceId} />}
    </div>
  )
}
