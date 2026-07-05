import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_PORTS,
  ENGINE_LABELS,
  dbConnectionsApi,
  type DbConnectionCreate,
  type DbConnectionDto,
  type DbEngine,
} from '../api/dbConnections'
import type { DocumentDto } from '../api/documents'
import { ApiError } from '../api/client'

const ENGINES: DbEngine[] = ['postgres', 'mysql', 'mssql', 'oracle', 'mongodb']

const inputClass =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500'

function ConnectionForm({
  workspaceId,
  onCreated,
}: {
  workspaceId: string
  onCreated: () => void
}) {
  const [form, setForm] = useState<DbConnectionCreate>({
    name: '',
    engine: 'postgres',
    host: '',
    port: DEFAULT_PORTS.postgres,
    database: '',
    username: '',
    password: '',
  })
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function updateEngine(engine: DbEngine) {
    setForm((f) => ({ ...f, engine, port: DEFAULT_PORTS[engine] }))
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await dbConnectionsApi.testNew(workspaceId, form)
      setTestResult({ ok: r.success, msg: r.message })
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof ApiError ? err.message : 'خطا' })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await dbConnectionsApi.create(workspaceId, form)
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در ذخیره اتصال')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="mb-6 space-y-3 rounded-xl bg-zinc-800/50 p-5">
      <h3 className="text-sm font-semibold text-zinc-200">اتصال جدید به دیتابیس</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-zinc-400">نام اتصال</label>
          <input
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">نوع دیتابیس</label>
          <select value={form.engine} onChange={(e) => updateEngine(e.target.value as DbEngine)} className={inputClass}>
            {ENGINES.map((e) => (
              <option key={e} value={e}>
                {ENGINE_LABELS[e]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">هاست</label>
          <input
            required
            value={form.host}
            onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">پورت</label>
          <input
            required
            type="number"
            value={form.port}
            onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) }))}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">
            {form.engine === 'mongodb' ? 'نام دیتابیس' : 'نام دیتابیس / اسکیما'}
          </label>
          <input
            required
            value={form.database}
            onChange={(e) => setForm((f) => ({ ...f, database: e.target.value }))}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">نام کاربری</label>
          <input
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">رمز عبور</label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-600 disabled:opacity-50"
        >
          {testing ? 'در حال تست...' : 'تست اتصال'}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? 'در حال ذخیره...' : 'ذخیره اتصال'}
        </button>
      </div>
      {testResult && (
        <p className={`text-xs ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>{testResult.msg}</p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </form>
  )
}

function ConnectionCard({
  workspaceId,
  connection,
  onChanged,
}: {
  workspaceId: string
  connection: DbConnectionDto
  onChanged: () => void
}) {
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [schemaDocs, setSchemaDocs] = useState<DocumentDto[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function reloadDocs() {
    setSchemaDocs(await dbConnectionsApi.listSchemaDocs(workspaceId, connection.id))
  }

  useEffect(() => {
    reloadDocs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.id])

  async function handleTest() {
    setBusy(true)
    setTestResult(null)
    try {
      const r = await dbConnectionsApi.test(workspaceId, connection.id)
      setTestResult({ ok: r.success, msg: r.message })
    } finally {
      setBusy(false)
    }
  }

  async function handleRefreshSchema() {
    setBusy(true)
    try {
      await dbConnectionsApi.refreshSchema(workspaceId, connection.id)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`اتصال «${connection.name}» حذف شود؟`)) return
    await dbConnectionsApi.remove(workspaceId, connection.id)
    onChanged()
  }

  async function handleUploadSchemaDoc(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await dbConnectionsApi.uploadSchemaDoc(workspaceId, connection.id, file)
      await reloadDocs()
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const tableCount = Array.isArray((connection.schema_summary as { tables?: unknown[] })?.tables)
    ? ((connection.schema_summary as { tables: unknown[] }).tables.length)
    : Array.isArray((connection.schema_summary as { collections?: unknown[] })?.collections)
      ? ((connection.schema_summary as { collections: unknown[] }).collections.length)
      : 0

  return (
    <div className="mb-4 rounded-xl border border-zinc-800 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <span className="font-medium text-zinc-100">{connection.name}</span>
          <span className="mr-2 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
            {ENGINE_LABELS[connection.engine]}
          </span>
        </div>
        <button onClick={handleDelete} className="text-xs text-red-400 hover:underline">
          حذف اتصال
        </button>
      </div>
      <p className="mb-2 text-xs text-zinc-500">
        {connection.host}:{connection.port} / {connection.database} —{' '}
        {connection.last_introspected_at
          ? `${tableCount} جدول/کالکشن شناسایی شد`
          : 'اسکیما هنوز استخراج نشده'}
      </p>

      <div className="mb-3 flex items-center gap-3">
        <button
          onClick={handleTest}
          disabled={busy}
          className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-600 disabled:opacity-50"
        >
          تست اتصال
        </button>
        <button
          onClick={handleRefreshSchema}
          disabled={busy}
          className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-600 disabled:opacity-50"
        >
          به‌روزرسانی اسکیما
        </button>
        {testResult && (
          <span className={`text-xs ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>{testResult.msg}</span>
        )}
      </div>

      <div className="rounded-lg bg-zinc-900/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs text-zinc-400">سند آموزش معنای جدول‌ها/فیلدها (pdf, docx, xlsx, csv)</p>
          <label className="cursor-pointer rounded-lg bg-indigo-600/80 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500">
            {uploading ? 'در حال آپلود...' : 'آپلود سند'}
            <input ref={fileInputRef} type="file" onChange={handleUploadSchemaDoc} disabled={uploading} className="hidden" />
          </label>
        </div>
        {schemaDocs.length === 0 ? (
          <p className="text-xs text-zinc-600">هنوز سندی آپلود نشده است</p>
        ) : (
          <ul className="space-y-1">
            {schemaDocs.map((d) => (
              <li key={d.id} className="flex items-center justify-between text-xs text-zinc-300">
                <span>{d.filename}</span>
                <span className={d.status === 'ready' ? 'text-emerald-400' : d.status === 'failed' ? 'text-red-400' : 'text-amber-400'}>
                  {d.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default function DbConnectionsPanel({ workspaceId }: { workspaceId: string }) {
  const [connections, setConnections] = useState<DbConnectionDto[]>([])
  const [showForm, setShowForm] = useState(false)

  async function reload() {
    setConnections(await dbConnectionsApi.list(workspaceId))
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-zinc-400">
          پس از اتصال، یک سند توضیحی درباره معنای جدول‌ها/فیلدها آپلود کنید تا بتوانید با زبان طبیعی از داده‌ها سوال بپرسید.
        </p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-600"
        >
          {showForm ? 'بستن فرم' : '+ اتصال جدید'}
        </button>
      </div>

      {showForm && (
        <ConnectionForm
          workspaceId={workspaceId}
          onCreated={() => {
            setShowForm(false)
            reload()
          }}
        />
      )}

      {connections.map((c) => (
        <ConnectionCard key={c.id} workspaceId={workspaceId} connection={c} onChanged={reload} />
      ))}
      {connections.length === 0 && !showForm && (
        <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
          هنوز اتصال دیتابیسی ثبت نشده است
        </p>
      )}
    </div>
  )
}
