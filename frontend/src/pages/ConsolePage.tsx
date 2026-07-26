import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  dbConnectionsApi,
  executeConsoleQuery,
  type ConsoleResult,
  type DbConnectionDto,
} from '../api/dbConnections'
import ResultGrid from '../components/ResultGrid'
import { Alert, Select, Spinner } from '../components/ui'
import { IconDatabase, IconSend } from '../components/icons'

/**
 * SQL console — the centre of Chat2DB's workspace, which Bina previously had no
 * equivalent of. Write a query, run it, read the grid.
 *
 * Read-only is still enforced server-side. A console is exactly where a stray UPDATE
 * against a live accounting database would do damage, so lifting that is a deliberate
 * decision to take on its own rather than a side effect of adding this page.
 */
export default function ConsolePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [connections, setConnections] = useState<DbConnectionDto[]>([])
  const [connectionId, setConnectionId] = useState('')
  const [sql, setSql] = useState('')
  const [result, setResult] = useState<ConsoleResult | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (!workspaceId) return
    dbConnectionsApi.list(workspaceId).then((list) => {
      setConnections(list)
      if (list.length > 0) setConnectionId((cur) => cur || list[0].id)
    })
  }, [workspaceId])

  async function run() {
    if (!workspaceId || !connectionId || !sql.trim() || running) return
    setRunning(true)
    setError('')
    try {
      setResult(await executeConsoleQuery(workspaceId, connectionId, sql.trim()))
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : 'اجرای کوئری ناموفق بود')
    } finally {
      setRunning(false)
    }
  }

  if (!workspaceId) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
        <div className="flex min-w-0 items-center gap-2">
          <IconDatabase className="shrink-0 text-primary" />
          <span className="text-sm font-semibold">کنسول SQL</span>
        </div>
        <div className="flex items-center gap-2">
          {connections.length > 0 && (
            <Select
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
              className="h-8 w-56 text-xs"
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          <button
            onClick={run}
            disabled={running || !sql.trim() || !connectionId}
            title="اجرا — Ctrl+Enter"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? <Spinner className="size-3.5" /> : <IconSend className="size-3.5" />}
            اجرا
          </button>
        </div>
      </header>

      {connections.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          برای استفاده از کنسول، ابتدا یک اتصال دیتابیس به این فضای کاری اضافه کنید.
        </p>
      ) : (
        <>
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                void run()
              }
            }}
            spellCheck={false}
            dir="ltr"
            placeholder="SELECT * FROM ..."
            className="h-48 shrink-0 resize-none border-b border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
          />

          {error && (
            <div className="p-3">
              <Alert kind="error">{error}</Alert>
            </div>
          )}

          {result ? (
            <ResultGrid result={result} />
          ) : (
            !error && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                کوئری را بنویسید و Ctrl+Enter بزنید.
              </p>
            )
          )}
        </>
      )}
    </div>
  )
}
