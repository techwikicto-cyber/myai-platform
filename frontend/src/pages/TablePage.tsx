import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { previewTable, type TablePreview } from '../api/dbConnections'
import ResultGrid from '../components/ResultGrid'
import { Alert, Spinner } from '../components/ui'
import { IconChevronDown, IconTable } from '../components/icons'

/**
 * Table data browser — Chat2DB's "click a table, see what's in it". The point is that
 * reading a table shouldn't require writing SQL first, which for Bina's non-technical
 * users is the difference between the database being browsable and not.
 */
export default function TablePage() {
  const { workspaceId, connectionId, tableName } = useParams<{
    workspaceId: string
    connectionId: string
    tableName: string
  }>()
  const [tab, setTab] = useState<'data' | 'structure'>('data')
  const [preview, setPreview] = useState<TablePreview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!workspaceId || !connectionId || !tableName) return
    setLoading(true)
    setError('')
    previewTable(workspaceId, connectionId, tableName)
      .then(setPreview)
      .catch((e) => setError(e instanceof Error ? e.message : 'خواندن جدول ناموفق بود'))
      .finally(() => setLoading(false))
  }, [workspaceId, connectionId, tableName])

  if (!workspaceId) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Link to={`/workspace/${workspaceId}`} className="text-muted-foreground hover:text-foreground">
            فضای کاری
          </Link>
          <IconChevronDown className="size-3 shrink-0 -rotate-90 text-muted-foreground" />
          <IconTable className="size-4 shrink-0 text-primary" />
          <span className="truncate font-semibold" dir="ltr" title={preview?.name || tableName}>
            {preview?.name || tableName}
          </span>
        </div>
        <div className="flex gap-1 rounded-lg bg-muted/60 p-0.5">
          {[
            { key: 'data' as const, label: 'داده‌ها' },
            { key: 'structure' as const, label: 'ساختار' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={clsx(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                tab === t.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="p-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : preview && tab === 'data' ? (
        <ResultGrid
          result={{
            columns: preview.columns,
            rows: preview.rows,
            truncated: preview.truncated,
            duration_ms: 0,
          }}
        />
      ) : preview ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-xs" dir="ltr">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="border-b border-l border-border px-3 py-1.5 text-left font-medium">ستون</th>
                <th className="border-b border-border px-3 py-1.5 text-left font-medium">نوع</th>
              </tr>
            </thead>
            <tbody>
              {preview.columns_meta.map((c) => (
                <tr key={c.name} className="hover:bg-muted/50">
                  <td className="border-b border-l border-border px-3 py-1 font-medium text-foreground/90">
                    {c.name}
                  </td>
                  <td className="border-b border-border px-3 py-1 text-muted-foreground">{c.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
