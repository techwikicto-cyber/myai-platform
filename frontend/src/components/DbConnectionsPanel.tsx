import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
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
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select, Spinner } from './ui'
import { IconDatabase, IconDocument, IconPlus, IconTrash, IconUpload } from './icons'

const ENGINES: DbEngine[] = ['postgres', 'mysql', 'mssql', 'oracle', 'mongodb']

function ConnectionForm({ workspaceId, onCreated }: { workspaceId: string; onCreated: () => void }) {
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
    <Card className="mb-6">
      <CardHeader title="اتصال جدید به دیتابیس" description="پس از ذخیره، ساختار جدول‌ها به‌صورت خودکار خوانده می‌شود" />
      <form onSubmit={handleSave} className="p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="نام اتصال">
            <Input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="نوع دیتابیس">
            <Select value={form.engine} onChange={(e) => updateEngine(e.target.value as DbEngine)}>
              {ENGINES.map((e) => (
                <option key={e} value={e}>
                  {ENGINE_LABELS[e]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="هاست">
            <Input required dir="ltr" value={form.host} onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))} />
          </Field>
          <Field label="پورت">
            <Input
              required
              dir="ltr"
              type="number"
              value={form.port}
              onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) }))}
            />
          </Field>
          <Field label={form.engine === 'mongodb' ? 'نام دیتابیس' : 'نام دیتابیس / اسکیما'}>
            <Input
              required
              dir="ltr"
              value={form.database}
              onChange={(e) => setForm((f) => ({ ...f, database: e.target.value }))}
            />
          </Field>
          <Field label="نام کاربری" hint="توصیه: یک یوزر فقط-خواندنی (read-only) بسازید">
            <Input dir="ltr" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
          </Field>
          <Field label="رمز عبور">
            <Input
              dir="ltr"
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" size="sm" onClick={handleTest} disabled={testing || !form.host}>
            {testing && <Spinner />}
            تست اتصال
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Spinner />}
            ذخیره اتصال
          </Button>
          {testResult && <Alert kind={testResult.ok ? 'success' : 'error'}>{testResult.msg}</Alert>}
          {error && <Alert kind="error">{error}</Alert>}
        </div>
      </form>
    </Card>
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
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reloadDocs = useCallback(async () => {
    setSchemaDocs(await dbConnectionsApi.listSchemaDocs(workspaceId, connection.id))
  }, [workspaceId, connection.id])

  useEffect(() => {
    reloadDocs()
  }, [reloadDocs])

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
    setUploadError('')
    try {
      await dbConnectionsApi.uploadSchemaDoc(workspaceId, connection.id, file)
      await reloadDocs()
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'خطا در آپلود')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const summary = connection.schema_summary as { tables?: unknown[]; collections?: unknown[] } | null
  const tableCount = summary?.tables?.length ?? summary?.collections?.length ?? 0

  return (
    <Card className="mb-4">
      <div className="flex items-start justify-between gap-4 p-5 pb-0">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <IconDatabase className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">{connection.name}</span>
              <Badge kind="muted">{ENGINE_LABELS[connection.engine]}</Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground" dir="ltr">
              {connection.host}:{connection.port}/{connection.database}
            </p>
          </div>
        </div>
        <Button variant="destructive" size="sm" onClick={handleDelete} title="حذف اتصال">
          <IconTrash />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 p-5 pb-4">
        <Button variant="secondary" size="sm" onClick={handleTest} disabled={busy}>
          {busy && <Spinner />}
          تست اتصال
        </Button>
        <Button variant="secondary" size="sm" onClick={handleRefreshSchema} disabled={busy}>
          به‌روزرسانی اسکیما
        </Button>
        <span className="text-xs text-muted-foreground">
          {connection.last_introspected_at ? `${tableCount} جدول/کالکشن شناسایی شد` : 'اسکیما هنوز استخراج نشده'}
        </span>
        {testResult && <Alert kind={testResult.ok ? 'success' : 'error'}>{testResult.msg}</Alert>}
      </div>

      <div className="border-t border-border bg-muted/40 p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">سند آموزش اسکیما</p>
          <label
            className={clsx(
              'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted',
              uploading && 'pointer-events-none opacity-50',
            )}
          >
            {uploading ? <Spinner /> : <IconUpload />}
            آپلود سند
            <input ref={fileInputRef} type="file" onChange={handleUploadSchemaDoc} disabled={uploading} className="hidden" />
          </label>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          فایلی (pdf/docx/xlsx/csv) آپلود کنید که معنی جدول‌ها و فیلدها را توضیح می‌دهد — مدل با کمک آن کوئری دقیق‌تری می‌سازد.
        </p>
        {uploadError && (
          <div className="mb-3">
            <Alert kind="error">{uploadError}</Alert>
          </div>
        )}
        {schemaDocs.length === 0 ? (
          <p className="text-xs text-muted-foreground/70">هنوز سندی آپلود نشده است</p>
        ) : (
          <ul className="space-y-2">
            {schemaDocs.map((d) => (
              <li key={d.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-foreground">
                  <IconDocument className="text-muted-foreground" />
                  {d.filename}
                </span>
                <Badge kind={d.status === 'ready' ? 'success' : d.status === 'failed' ? 'error' : 'warning'}>
                  {d.status === 'ready' ? 'آماده' : d.status === 'failed' ? 'خطا' : 'در حال پردازش'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

export default function DbConnectionsPanel({ workspaceId }: { workspaceId: string }) {
  const [connections, setConnections] = useState<DbConnectionDto[]>([])
  const [showForm, setShowForm] = useState(false)

  const reload = useCallback(async () => {
    setConnections(await dbConnectionsApi.list(workspaceId))
  }, [workspaceId])

  useEffect(() => {
    reload()
  }, [reload])

  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          دیتابیس را وصل کنید، سند توضیح اسکیما آپلود کنید و بعد در چت با زبان طبیعی از داده‌ها سوال بپرسید.
        </p>
        <Button variant="secondary" size="sm" onClick={() => setShowForm((v) => !v)}>
          <IconPlus />
          {showForm ? 'بستن فرم' : 'اتصال جدید'}
        </Button>
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
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-12 text-center">
          <IconDatabase className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">هنوز اتصال دیتابیسی ثبت نشده است</p>
        </div>
      )}
    </div>
  )
}
