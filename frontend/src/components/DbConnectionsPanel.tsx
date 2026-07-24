import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  DEFAULT_PORTS,
  ENGINE_LABELS,
  dbConnectionsApi,
  type DbConnectionCreate,
  type DbConnectionDto,
  type DbEngine,
  type SharedConnectionDto,
} from '../api/dbConnections'
import type { DocumentDto } from '../api/documents'
import { ApiError } from '../api/client'
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select, Spinner } from './ui'
import { IconDatabase, IconDocument, IconGlobe, IconPlus, IconTrash, IconUpload } from './icons'
import { useAuthStore } from '../store/auth'
import ShareModal from './ShareModal'

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
    <>
      <form onSubmit={handleSave} className="p-6 pt-4">
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
      <div className="mx-6 mb-4 rounded-lg bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        پس از ذخیره، ساختار جدول‌ها به‌صورت خودکار خوانده می‌شود.
      </div>
    </>
  )
}

function AllowlistPanel({
  workspaceId,
  connection,
  onChanged,
}: {
  workspaceId: string
  connection: DbConnectionDto
  onChanged: () => void
}) {
  const summary = connection.schema_summary as { tables?: { name: string }[]; collections?: { name: string }[] } | null
  const items: string[] = summary?.tables?.map((t) => t.name) ?? summary?.collections?.map((c) => c.name) ?? []

  const [enabled, setEnabled] = useState<Set<string>>(() => {
    if (connection.allowed_tables === null) return new Set(items)
    return new Set(Object.keys(connection.allowed_tables))
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  if (items.length === 0) return null

  const allChecked = enabled.size === items.length
  const toggle = (name: string) => {
    setEnabled((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
    setSaved(false)
  }
  const toggleAll = () => {
    setEnabled(allChecked ? new Set() : new Set(items))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const payload = allChecked
        ? null
        : Object.fromEntries([...enabled].map((t) => [t, null]))
      await dbConnectionsApi.setAllowlist(workspaceId, connection.id, payload)
      setSaved(true)
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-t border-border bg-muted/40 p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">محدودسازی دسترسی جداول</p>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving && <Spinner />}
          {saved ? '✓ ذخیره شد' : 'ذخیره'}
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        فقط جداول انتخاب‌شده در کوئری‌های هوش مصنوعی در دسترس خواهند بود.
      </p>
      <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
        <input type="checkbox" checked={allChecked} onChange={toggleAll} className="accent-primary" />
        همه جداول
      </label>
      <div className="max-h-48 overflow-y-auto">
        {items.map((name) => (
          <label key={name} className="flex cursor-pointer items-center gap-2 py-1 text-xs text-foreground" dir="ltr">
            <input
              type="checkbox"
              checked={enabled.has(name)}
              onChange={() => toggle(name)}
              className="accent-primary"
            />
            {name}
          </label>
        ))}
      </div>
    </div>
  )
}

const MULTI_DB_ENGINES: DbEngine[] = ['postgres', 'mysql', 'mssql']

function DatabasesPanel({
  workspaceId,
  connection,
  onChanged,
}: {
  workspaceId: string
  connection: DbConnectionDto
  onChanged: () => void
}) {
  const [discovering, setDiscovering] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set(connection.selected_databases ?? []))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  if (!MULTI_DB_ENGINES.includes(connection.engine)) return null

  const available = connection.available_databases ?? []

  async function handleDiscover() {
    setDiscovering(true)
    setError('')
    try {
      await dbConnectionsApi.discoverDatabases(workspaceId, connection.id)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در فهرست‌کردن دیتابیس‌ها')
    } finally {
      setDiscovering(false)
    }
  }

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await dbConnectionsApi.setSelectedDatabases(workspaceId, connection.id, [...selected])
      setSaved(true)
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-t border-border p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">دیتابیس‌های این سرور</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            اگر این سرور چند دیتابیس دارد (مثلاً یک دیتابیس برای هر سال مالی)، دیتابیس‌هایی که می‌خواهی
            در دسترس مدل باشند را انتخاب کن؛ مدل می‌تواند حتی بین آن‌ها JOIN بزند.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={handleDiscover} disabled={discovering}>
          {discovering && <Spinner />}
          {available.length > 0 ? 'به‌روزرسانی فهرست' : 'فهرست دیتابیس‌ها'}
        </Button>
      </div>
      {error && (
        <div className="mb-3">
          <Alert kind="error">{error}</Alert>
        </div>
      )}
      {available.length > 0 && (
        <>
          <div className="max-h-48 overflow-y-auto rounded-lg bg-muted/40 p-3">
            {available.map((name) => (
              <label key={name} className="flex cursor-pointer items-center gap-2 py-1 text-xs text-foreground" dir="ltr">
                <input
                  type="checkbox"
                  checked={selected.has(name)}
                  onChange={() => toggle(name)}
                  className="accent-primary"
                />
                {name}
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving && <Spinner />}
              {saved ? '✓ ذخیره شد' : 'ذخیره انتخاب'}
            </Button>
            <span className="text-xs text-muted-foreground">
              بعد از ذخیره، دکمه «به‌روزرسانی اسکیما» را بزن تا جدول‌های دیتابیس‌های انتخابی خوانده شوند.
            </span>
          </div>
        </>
      )}
    </div>
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
  const currentUser = useAuthStore((s) => s.user)
  const isAdmin = currentUser?.role === 'admin'
  const [sharingOpen, setSharingOpen] = useState(false)
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

  // Schema docs also process in the background — poll until they settle.
  const hasInFlight = schemaDocs.some((d) => d.status === 'pending' || d.status === 'processing')
  useEffect(() => {
    if (!hasInFlight) return
    const timer = setInterval(reloadDocs, 3000)
    return () => clearInterval(timer)
  }, [hasInFlight, reloadDocs])

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
              {connection.host}:{connection.port}
              {connection.selected_databases && connection.selected_databases.length > 0
                ? ` (${connection.selected_databases.length} دیتابیس)`
                : `/${connection.database}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setSharingOpen(true)}
              title={
                connection.shared_workspace_ids.length > 0
                  ? `اشتراک با ${connection.shared_workspace_ids.length} فضای کاری`
                  : 'اشتراک‌گذاری با فضاهای کاری دیگر'
              }
              className={clsx(
                'rounded-md p-1.5 transition-colors',
                connection.shared_workspace_ids.length > 0
                  ? 'text-primary hover:text-primary/80'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <IconGlobe />
            </button>
          )}
          {sharingOpen && (
            <ShareModal
              currentWorkspaceId={workspaceId}
              currentSharedIds={connection.shared_workspace_ids}
              resourceName={connection.name}
              onSave={async (ids) => {
                await dbConnectionsApi.setShared(workspaceId, connection.id, ids)
                onChanged()
              }}
              onClose={() => setSharingOpen(false)}
            />
          )}
          <Button variant="destructive" size="sm" onClick={handleDelete} title="حذف اتصال">
            <IconTrash />
          </Button>
        </div>
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
              'inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted',
              uploading && 'pointer-events-none opacity-50',
            )}
          >
            {uploading ? <Spinner /> : <IconUpload className="size-4 shrink-0" />}
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
                  <IconDocument className="size-4 shrink-0 text-muted-foreground" />
                  {d.filename}
                </span>
                <span className={d.status === 'ready' || d.status === 'failed' ? '' : 'animate-pulse'}>
                  <Badge kind={d.status === 'ready' ? 'success' : d.status === 'failed' ? 'error' : 'warning'}>
                    {d.status === 'ready' ? 'آماده' : d.status === 'failed' ? 'خطا' : 'در حال پردازش'}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <DatabasesPanel workspaceId={workspaceId} connection={connection} onChanged={onChanged} />
      <AllowlistPanel workspaceId={workspaceId} connection={connection} onChanged={onChanged} />
    </Card>
  )
}

export default function DbConnectionsPanel({ workspaceId }: { workspaceId: string }) {
  const [connections, setConnections] = useState<DbConnectionDto[]>([])
  const [sharedConnections, setSharedConnections] = useState<SharedConnectionDto[]>([])
  const [showForm, setShowForm] = useState(false)

  const reload = useCallback(async () => {
    const [own, shared] = await Promise.all([
      dbConnectionsApi.list(workspaceId),
      dbConnectionsApi.listShared(workspaceId),
    ])
    setConnections(own)
    setSharedConnections(shared)
  }, [workspaceId])

  useEffect(() => {
    reload()
  }, [reload])

  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <Card className="mb-6">
        <CardHeader
          title="اتصال‌های دیتابیس"
          description="دیتابیس را وصل کنید، سند توضیح اسکیما آپلود کنید و بعد در چت با زبان طبیعی از داده‌ها سوال بپرسید."
          action={
            <button
              onClick={() => setShowForm((v) => !v)}
              className={clsx(
                'inline-flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-medium shadow-sm transition-colors',
                showForm
                  ? 'bg-muted text-foreground hover:bg-muted/80'
                  : 'bg-primary text-primary-foreground hover:bg-primary-hover',
              )}
            >
              <IconPlus />
              {showForm ? 'بستن فرم' : 'اتصال جدید'}
            </button>
          }
        />
        <div className="border-t border-border">
          {showForm && (
            <ConnectionForm
              workspaceId={workspaceId}
              onCreated={() => {
                setShowForm(false)
                reload()
              }}
            />
          )}
        </div>
      </Card>

      {connections.map((c) => (
        <ConnectionCard key={c.id} workspaceId={workspaceId} connection={c} onChanged={reload} />
      ))}
      {connections.length === 0 && !showForm && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-12 text-center">
          <IconDatabase className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">هنوز اتصال دیتابیسی ثبت نشده است</p>
        </div>
      )}

      {sharedConnections.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <IconGlobe className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">اتصال‌های به‌اشتراک‌گذاشته‌شده با این فضا</h3>
          </div>
          {sharedConnections.map((c) => (
            <Card key={c.id} className="mb-3">
              <div className="flex items-center gap-3 p-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <IconDatabase className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{c.name}</span>
                    <Badge kind="muted">{ENGINE_LABELS[c.engine]}</Badge>
                    <Badge kind="info">
                      <IconGlobe className="size-3" />
                      {c.source_workspace_name}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground" dir="ltr">
                    {c.host}/{c.database}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
