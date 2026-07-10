import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { API_BASE } from '../api/client'
import { useAuthStore } from '../store/auth'
import type { ChatMessage } from '../types'
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

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="در حال نوشتن">
      <span className="typing-dot inline-block size-1.5 rounded-full bg-muted-foreground" />
      <span className="typing-dot inline-block size-1.5 rounded-full bg-muted-foreground" />
      <span className="typing-dot inline-block size-1.5 rounded-full bg-muted-foreground" />
    </span>
  )
}

function CopyButton({ content, light = false }: { content: string; light?: boolean }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard API unavailable */
    }
  }

  return (
    <button
      onClick={handleCopy}
      title={copied ? 'کپی شد!' : 'کپی متن'}
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

export default function MessageBubble({
  message,
  onEdit,
  isPinned = false,
  onPin,
}: {
  message: ChatMessage
  onEdit?: () => void
  isPinned?: boolean
  onPin?: (messageId: string, content: string) => Promise<void>
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
            <CopyButton content={message.content} light />
            {onEdit && (
              <button
                onClick={onEdit}
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
                    {message.content}
                  </ReactMarkdown>
                </div>
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
            <CopyButton content={message.content} />

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
