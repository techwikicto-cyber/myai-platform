import { useMemo } from 'react'
import type { ConsoleResult } from '../api/dbConnections'
import { tableToCSV } from './MiniChart'
import { IconDownload } from './icons'

/**
 * Result grid for the SQL console, matching what Chat2DB shows under a query: column
 * headers, row numbers, a status line, and CSV export.
 *
 * Values are rendered as text rather than through Markdown — this is raw data, and a
 * cell that happens to contain `*` or `#` must not turn into formatting.
 */
export default function ResultGrid({ result }: { result: ConsoleResult }) {
  const csvRows = useMemo(
    () => result.rows.map((r) => result.columns.map((c) => String(r[c] ?? ''))),
    [result],
  )

  function handleExport() {
    const csv = tableToCSV(result.columns, csvRows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `query-result-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>
          {result.rows.length.toLocaleString('fa-IR')} ردیف
          {result.truncated && ' (محدودشده)'} — {result.duration_ms.toLocaleString('fa-IR')} میلی‌ثانیه
        </span>
        {result.rows.length > 0 && (
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
          >
            <IconDownload className="size-3.5" />
            CSV
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {result.rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">ردیفی برنگشت</p>
        ) : (
          <table className="w-full border-collapse text-xs" dir="ltr">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr>
                <th className="w-12 border-b border-l border-border px-2 py-1.5 text-right font-medium text-muted-foreground">
                  #
                </th>
                {result.columns.map((c) => (
                  <th
                    key={c}
                    className="whitespace-nowrap border-b border-l border-border px-3 py-1.5 text-left font-medium text-foreground"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i} className="hover:bg-muted/50">
                  <td className="border-b border-l border-border px-2 py-1 text-right text-muted-foreground/70">
                    {i + 1}
                  </td>
                  {result.columns.map((c) => {
                    const v = row[c]
                    return (
                      <td
                        key={c}
                        className="max-w-[320px] truncate border-b border-l border-border px-3 py-1 text-foreground/90"
                        title={v === null || v === undefined ? '' : String(v)}
                      >
                        {v === null || v === undefined ? (
                          <span className="text-muted-foreground/50">NULL</span>
                        ) : (
                          String(v)
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
