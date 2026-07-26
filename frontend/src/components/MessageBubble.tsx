import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { API_BASE } from '../api/client'
import { copyText } from '../lib/clipboard'
import { useAuthStore } from '../store/auth'
import type { ChatMode } from '../api/chat'
import type { ChatMessage } from '../types'

export type SqlActionHandler = (mode: Extract<ChatMode, 'explain' | 'optimize' | 'debug'>, sql: string) => void
import {
  IconBarChart,
  IconCheckSmall,
  IconCopy,
  IconDownload,
  IconEdit,
  IconPin,
  IconPinFilled,
} from './icons'
import OwlLogo from './Logo'
import MiniChart, { parseMarkdownTable, tableToCSV } from './MiniChart'

/**
 * Chat2DB renders an answer as typed parts (MARKDOWN / DATA / TABLE / …) rather than
 * one flat blob. Bina's model already emits the executed query as a fenced sql block
 * (the prompt asks it to); lifting that out into its own collapsed panel gives the same
 * separation without changing the backend response format — the prose stays readable
 * and the SQL is there when you want to verify it.
 */
function splitExecutedSql(content: string): { prose: string; sql: string | null } {
  const fence = /```sql\s*\n([\s\S]*?)```/i
  const match = content.match(fence)
  if (!match) return { prose: content, sql: null }
  return { prose: content.replace(fence, '').replace(/\n{3,}/g, '\n\n').trim(), sql: match[1].trim() }
}

/**
 * Chat2DB reaches SQL_EXPLAIN / SQL_OPTIMIZER / SQL_DEBUG from actions sitting next to
 * the query itself rather than from a mode picked before asking. Same here: these
 * buttons only exist where a real query does, and they carry that query along.
 */
function ExecutedSql({ sql, onSqlAction }: { sql: string; onSqlAction?: SqlActionHandler }) {
  const [open, setOpen] = useState(false)
  const actions: { mode: 'explain' | 'optimize' | 'debug'; label: string }[] = [
    { mode: 'explain', label: 'توضیح' },
    { mode: 'optimize', label: 'بهینه‌سازی' },
    { mode: 'debug', label: 'رفع خطا' },
  ]
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 bg-muted/50 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>کوئری اجراشده</span>
        <span className="flex items-center gap-1.5">
          <CopyButton content={sql} label="کپی کوئری" />
          <span>{open ? '−' : '+'}</span>
        </span>
      </button>
      {open && (
        <>
          <pre className="overflow-x-auto bg-background px-3 py-2 text-[11px] leading-relaxed" dir="ltr">
            <code>{sql}</code>
          </pre>
          {onSqlAction && (
            <div className="flex flex-wrap gap-1.5 border-t border-border bg-muted/30 px-2.5 py-1.5">
              {actions.map((a) => (
                <button
                  key={a.mode}
                  onClick={() => onSqlAction(a.mode, sql)}
                  className="rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="در حال نوشتن">
      <span className="typing-dot inline-block size-1.5 rounded-full bg-muted-foreground" />
      <span className="typing-dot inline-block size-1.5 rounded-full bg-muted-foreground" />
      <span className="typing-dot inline-block size-1.5 rounded-full bg-muted-foreground" />
    </span>
  )
}

function CopyButton({
  content,
  label = 'کپی متن',
  light = false,
}: {
  content: string
  label?: string
  light?: boolean
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (await copyText(content)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button
      onClick={handleCopy}
      title={copied ? 'کپی شد!' : label}
      className={`rounded-md p-1.5 transition-all ${
        light
          ? 'text-primary-foreground/60 hover:text-primary-foreground'
          : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted'
      } ${copied ? (light ? 'text-primary-foreground' : 'text-primary') : ''}`}
    >
      {copied ? <IconCheckSmall /> : <IconCopy />}
    </button>
  )
}

function MessageBubble({
  message,
  onEdit,
  isPinned = false,
  onPin,
  onSqlAction,
  onRetryWithQuery,
}: {
  message: ChatMessage
  onEdit?: (messageId: string, content: string) => void
  isPinned?: boolean
  onPin?: (messageId: string, content: string) => Promise<void>
  onSqlAction?: SqlActionHandler
  onRetryWithQuery?: (assistantMessageId: string) => void
}) {
  const [showChart, setShowChart] = useState(false)
  const [pinning, setPinning] = useState(false)
  const [exporting, setExporting] = useState(false)

  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="animate-fade-up flex w-full justify-start">
        <div className="group flex flex-col items-start gap-0.5">
          <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-md shadow-primary/15">
            <div className="markdown-body [&_code]:bg-white/20 [&_pre]:border-white/20 [&_pre]:bg-white/10">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          </div>
          <div className="mt-1 flex items-center gap-0.5 px-1 text-muted-foreground/70 transition-opacity duration-150 hover:text-foreground">
            <CopyButton content={message.content} label="کپی سوال" />
            {onEdit && (
              <button
                onClick={() => onEdit(message.id, message.content)}
                title="ویرایش سوال"
                className="rounded-md p-1.5 text-muted-foreground/60 transition-all hover:bg-muted hover:text-foreground"
              >
                <IconEdit />
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const showTyping = message.pending && !message.content
  const { prose, sql } = splitExecutedSql(message.content)
  const tableData = !showTyping && !message.pending ? parseMarkdownTable(message.content) : null
  const hasTable = tableData !== null
  const serverExportIds = message.export_ids || []
  const hasServerExport = serverExportIds.length > 0

  async function handlePin() {
    if (!onPin || !message.id || message.id.startsWith('tmp-')) return
    setPinning(true)
    try {
      await onPin(message.id, message.content)
    } finally {
      setPinning(false)
    }
  }

  async function handleExport() {
    // Server export re-runs the audited query with a high row cap — the full
    // dataset, not just the rows that fit in the chat context window.
    if (hasServerExport) {
      setExporting(true)
      try {
        const token = useAuthStore.getState().token
        for (const auditId of serverExportIds) {
          const res = await fetch(`${API_BASE}/query-audits/${auditId}/export`, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          })
          if (!res.ok) continue
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `report-${auditId.slice(0, 8)}.csv`
          a.click()
          URL.revokeObjectURL(url)
        }
      } finally {
        setExporting(false)
      }
      return
    }

    // Fallback: export the markdown table rendered in this message.
    if (!tableData) return
    const csv = tableToCSV(tableData.headers, tableData.rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="animate-fade-up flex w-full justify-end">
      <div className="group flex flex-col items-end gap-0.5">
        <div className="flex max-w-[85%] items-start gap-2.5">
          <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2.5 text-sm leading-relaxed text-foreground shadow-sm">
            {showTyping ? (
              <TypingDots />
            ) : (
              <>
                <div className="markdown-body [&_hr]:my-3 [&_hr]:border-border">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                    {prose}
                  </ReactMarkdown>
                </div>
                {sql && <ExecutedSql sql={sql} onSqlAction={onSqlAction} />}
                {showChart && tableData && (
                  <MiniChart headers={tableData.headers} rows={tableData.rows} />
                )}
              </>
            )}
          </div>
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft">
            <OwlLogo className="size-6 shrink-0" />
          </div>
        </div>

        {/* Action buttons — visible on hover, only after content arrives */}
        {!showTyping && !message.pending && (
          <div className="mt-1 flex items-center gap-0.5 px-9 text-muted-foreground/70 transition-opacity duration-150">
            <CopyButton content={message.content} label="کپی پاسخ" />

            {(hasTable || hasServerExport) && (
              <button
                onClick={handleExport}
                disabled={exporting}
                title={hasServerExport ? 'دانلود CSV کامل (همه ردیف‌ها)' : 'دانلود CSV'}
                className="rounded-md p-1.5 text-muted-foreground/60 transition-all hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <IconDownload className={exporting ? 'animate-pulse' : undefined} />
              </button>
            )}
            {hasTable && (
              <button
                onClick={() => setShowChart((v) => !v)}
                title={showChart ? 'پنهان کردن نمودار' : 'نمایش نمودار'}
                className={`rounded-md p-1.5 transition-all hover:bg-muted ${
                  showChart ? 'text-primary' : 'text-muted-foreground/60 hover:text-foreground'
                }`}
              >
                <IconBarChart />
              </button>
            )}

            {onRetryWithQuery && !hasServerExport && (
              <button
                onClick={() => onRetryWithQuery(message.id)}
                title="این پاسخ بدون اجرای کوئری ساخته شده — دوباره بپرس و این بار حتماً روی دیتابیس کوئری بزن"
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground/70 transition-all hover:bg-muted hover:text-primary"
              >
                با کوئری دوباره بپرس
              </button>
            )}

            {onPin && !message.id.startsWith('tmp-') && (
              <button
                onClick={handlePin}
                disabled={pinning}
                title={isPinned ? 'از پین خارج کن' : 'پین کن'}
                className={`rounded-md p-1.5 transition-all hover:bg-muted disabled:opacity-50 ${
                  isPinned ? 'text-amber-500' : 'text-muted-foreground/60 hover:text-foreground'
                }`}
              >
                {isPinned ? <IconPinFilled /> : <IconPin />}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Chat threads can grow to hundreds of messages. Without this, every streaming token
// update (setMessages creates a new array) re-renders every bubble in the list — each
// one re-running react-markdown over unchanged content — even though .map() already
// preserves object identity for every message except the one actually changing. memo()
// lets that identity check actually pay off. Requires every prop passed in from
// WorkspacePage to be referentially stable (useCallback for onEdit/onPin), otherwise
// this comparison always fails and memo does nothing.
export default memo(MessageBubble)
