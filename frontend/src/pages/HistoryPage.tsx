import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import clsx from 'clsx'
import { historyApi, type QueryHistoryItem } from '../api/history'
import { Badge, Spinner } from '../components/ui'
import { IconClock } from '../components/icons'

const STATUS_LABEL: Record<QueryHistoryItem['status'], { kind: 'success' | 'error' | 'warning'; label: string }> = {
  success: { kind: 'success', label: 'موفق' },
  rejected: { kind: 'warning', label: 'رد شده' },
  error: { kind: 'error', label: 'خطا' },
}

/**
 * Query history — Chat2DB keeps an execution log; Bina was already writing one for
 * every query (console and assistant alike) but had no way to look at it. Showing both
 * sources in one list is the point: when an answer looks wrong, the query behind it is
 * here next to the ones you ran by hand.
 */
export default function HistoryPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [items, setItems] = useState<QueryHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId) return
    historyApi
      .list(workspaceId)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [workspaceId])

  if (!workspaceId) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-4">
        <IconClock className="text-primary" />
        <span className="text-sm font-semibold">تاریخچه کوئری‌ها</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">هنوز کوئری‌ای اجرا نشده است.</p>
        ) : (
          <ul className="mx-auto max-w-4xl space-y-2">
            {items.map((it) => {
              const st = STATUS_LABEL[it.status]
              const open = expanded === it.id
              return (
                <li key={it.id} className="overflow-hidden rounded-lg border border-border bg-card">
                  <button
                    onClick={() => setExpanded(open ? null : it.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-right transition-colors hover:bg-muted/40"
                  >
                    <Badge kind={st.kind}>{st.label}</Badge>
                    <Badge kind="muted">{it.source === 'assistant' ? 'دستیار' : 'کنسول'}</Badge>
                    <code
                      className="min-w-0 flex-1 truncate text-left text-[11px] text-foreground/80"
                      dir="ltr"
                      title={it.raw_query}
                    >
                      {it.raw_query}
                    </code>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {new Date(it.created_at).toLocaleString('fa-IR', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </button>

                  {open && (
                    <div className="space-y-2 border-t border-border bg-muted/20 px-3 py-2">
                      <pre
                        className="overflow-x-auto rounded-md bg-background p-2 text-[11px] leading-relaxed"
                        dir="ltr"
                      >
                        <code>{it.executed_query || it.raw_query}</code>
                      </pre>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                        {it.connection_name && <span>اتصال: {it.connection_name}</span>}
                        {it.user_email && <span>کاربر: {it.user_email}</span>}
                        {it.row_count !== null && <span>{it.row_count.toLocaleString('fa-IR')} ردیف</span>}
                        {it.duration_ms !== null && (
                          <span>{it.duration_ms.toLocaleString('fa-IR')} میلی‌ثانیه</span>
                        )}
                      </div>
                      {it.error_message && (
                        <p className={clsx('text-[11px] leading-relaxed text-destructive')} dir="ltr">
                          {it.error_message}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
