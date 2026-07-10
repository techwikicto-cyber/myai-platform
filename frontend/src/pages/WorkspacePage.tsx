import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { chatApi, streamMessage } from '../api/chat'
import { pinsApi } from '../api/pins'
import { workspacesApi } from '../api/workspaces'
import MessageBubble from '../components/MessageBubble'
import { Alert } from '../components/ui'
import {
  IconCheckSmall,
  IconChat,
  IconCopy,
  IconDownload,
  IconMic,
  IconPin,
  IconRedo,
  IconSend,
  IconSettings,
  IconStop,
  IconX,
} from '../components/icons'
import { parseMarkdownTable, tableToCSV } from '../components/MiniChart'
import { useThreadStore } from '../store/threads'
import type { ChatMessage, PinDto, Workspace } from '../types'

export default function WorkspacePage() {
  const { workspaceId, threadId } = useParams<{ workspaceId: string; threadId?: string }>()
  const navigate = useNavigate()
  const threadStore = useThreadStore()

  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [pins, setPins] = useState<PinDto[]>([])
  const [showPins, setShowPins] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const currentThreadTitleRef = useRef<string>('گفتگوی جدید')

  const pinnedMessageIds = useMemo(() => new Set(pins.map((p) => p.message_id)), [pins])

  // Load workspace info
  useEffect(() => {
    if (!workspaceId) return
    workspacesApi.get(workspaceId).then(setWorkspace).catch(() => {})
  }, [workspaceId])

  // Load pins when workspace changes
  useEffect(() => {
    if (!workspaceId) return
    pinsApi.list(workspaceId).then(setPins).catch(() => {})
  }, [workspaceId])

  // Load or initialize thread when workspaceId or threadId changes
  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false

    if (!threadId) {
      // Resolve thread and redirect
      chatApi.listThreads(workspaceId).then(async (threads) => {
        if (cancelled) return
        let t
        if (threads.length > 0) {
          t = threads[0]
          threadStore.setThreads(workspaceId, threads)
        } else {
          t = await chatApi.createThread(workspaceId)
          if (cancelled) return
          threadStore.setThreads(workspaceId, [t])
        }
        if (!cancelled) navigate(`/workspace/${workspaceId}/thread/${t.id}`, { replace: true })
      })
      return () => {
        cancelled = true
      }
    }

    // Thread ID is known — load its messages
    setMessages([])
    setError('')
    currentThreadTitleRef.current = 'گفتگوی جدید'

    chatApi.listMessages(threadId).then((msgs) => {
      if (!cancelled) {
        setMessages(msgs)
        // Infer current thread title
        const threadInStore = (threadStore.threadsByWs[workspaceId] || []).find((t) => t.id === threadId)
        if (threadInStore) currentThreadTitleRef.current = threadInStore.title
      }
    })

    return () => {
      cancelled = true
    }
  }, [workspaceId, threadId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault()
    if (!input.trim() || !threadId || sending) return
    setError('')
    const userText = input.trim()
    setInput('')
    setSending(true)

    const userMsg: ChatMessage = { id: `tmp-user-${Date.now()}`, role: 'user', content: userText }
    const assistantMsg: ChatMessage = { id: `tmp-assistant-${Date.now()}`, role: 'assistant', content: '', pending: true }
    setMessages((prev) => [...prev, userMsg, assistantMsg])

    const controller = new AbortController()
    abortControllerRef.current = controller
    const tmpAssistantId = assistantMsg.id

    try {
      await streamMessage(threadId, userText, (event) => {
        if (event.type === 'token') {
          setMessages((prev) =>
            prev.map((m) => (m.id === tmpAssistantId ? { ...m, content: m.content + event.content, pending: false } : m)),
          )
        } else if (event.type === 'done') {
          // Replace temp ID with real backend ID and attach export links
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tmpAssistantId
                ? { ...m, id: event.message_id, pending: false, export_ids: event.export_ids || [] }
                : m,
            ),
          )
          // Update thread title in store if it was the first message
          if (workspaceId && currentThreadTitleRef.current === 'گفتگوی جدید') {
            const newTitle = userText.slice(0, 60)
            currentThreadTitleRef.current = newTitle
            threadStore.upsertThread(workspaceId, {
              id: threadId,
              workspace_id: workspaceId,
              title: newTitle,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
          }
        } else if (event.type === 'error') {
          setError(event.message)
        }
      }, controller.signal)
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'خطا در دریافت پاسخ')
      }
    } finally {
      abortControllerRef.current = null
      setSending(false)
      setMessages((prev) =>
        prev.map((m) => (m.id === tmpAssistantId && m.pending ? { ...m, pending: false } : m)),
      )
    }
  }

  function handleStop() {
    abortControllerRef.current?.abort()
  }

  const handleEdit = useCallback((msgId: string, content: string) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msgId)
      return idx === -1 ? prev : prev.slice(0, idx)
    })
    setInput(content)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [])

  async function handlePin(messageId: string, content: string) {
    if (pinnedMessageIds.has(messageId)) {
      const pin = pins.find((p) => p.message_id === messageId)
      if (pin) {
        await pinsApi.delete(pin.id)
        setPins((prev) => prev.filter((p) => p.id !== pin.id))
      }
    } else {
      const idx = messages.findIndex((m) => m.id === messageId)
      let question = ''
      for (let i = idx - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          question = messages[i].content
          break
        }
      }
      const newPin = await pinsApi.create(messageId, question, content)
      setPins((prev) => [newPin, ...prev])
    }
  }

  function handleAskAgain(question: string) {
    setInput(question)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  if (!workspaceId) return null

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
        <h2 className="text-sm font-semibold text-foreground">{workspace?.name}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPins((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${
              showPins
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <IconPin />
            پیام‌های پین‌شده
            {pins.length > 0 && (
              <span className="flex size-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                {pins.length}
              </span>
            )}
          </button>
          {workspace?.is_manager && (
            <Link
              to={`/workspace/${workspaceId}/settings`}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <IconSettings />
              تنظیمات
            </Link>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Chat area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
            {messages.length === 0 && !error && (
              <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <IconChat className="size-6" />
                </div>
                <p className="text-sm text-muted-foreground">
                  سوال خود را بپرسید — پاسخ بر اساس اسناد و داده‌های این فضای کاری داده می‌شود.
                </p>
              </div>
            )}
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onEdit={m.role === 'user' ? () => handleEdit(m.id, m.content) : undefined}
                isPinned={pinnedMessageIds.has(m.id)}
                onPin={m.role === 'assistant' ? handlePin : undefined}
              />
            ))}
          </div>
        </div>

        {/* Pins panel */}
        {showPins && (
          <div className="flex w-80 shrink-0 flex-col border-r border-border bg-card">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <div className="flex items-center gap-2">
                <IconPin className="text-amber-500" />
                <span className="text-sm font-semibold">پیام‌های پین‌شده</span>
              </div>
              <button
                onClick={() => setShowPins(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <IconX />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {pins.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  هنوز پیامی پین نشده است.
                  <br />
                  روی پیام‌های مهم دکمه 📌 را بزنید.
                </p>
              )}
              {pins.map((pin) => (
                <PinCard
                  key={pin.id}
                  pin={pin}
                  onUnpin={async () => {
                    await pinsApi.delete(pin.id)
                    setPins((prev) => prev.filter((p) => p.id !== pin.id))
                  }}
                  onAskAgain={handleAskAgain}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border bg-card px-6 py-4">
        <div className="mx-auto max-w-3xl">
          {error && (
            <div className="mb-3">
              <Alert kind="error">{error}</Alert>
            </div>
          )}
          <form onSubmit={handleSend}>
            <div className="flex items-end gap-2 rounded-xl border border-border bg-background p-2 transition-colors focus-within:border-primary">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                rows={1}
                placeholder="پیام خود را بنویسید…"
                className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
              />
              <button
                type="button"
                disabled
                title="بزودی — ارسال پیام صوتی"
                className="flex size-9 cursor-not-allowed items-center justify-center rounded-lg text-muted-foreground/30 transition-colors"
              >
                <IconMic />
              </button>
              {sending ? (
                <button
                  type="button"
                  onClick={handleStop}
                  title="توقف پاسخ"
                  className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-destructive/40 bg-destructive/10 px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
                >
                  <IconStop />
                  توقف
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconSend />
                  ارسال
                </button>
              )}
            </div>
            <p className="mt-1.5 px-1 text-[11px] text-muted-foreground/70">
              Enter برای ارسال — Shift+Enter برای خط جدید
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}

function PinCard({
  pin,
  onUnpin,
  onAskAgain,
}: {
  pin: PinDto
  onUnpin: () => Promise<void>
  onAskAgain: (question: string) => void
}) {
  const [unpinning, setUnpinning] = useState(false)
  const [copied, setCopied] = useState(false)
  const [questionCopied, setQuestionCopied] = useState(false)

  const tableData = useMemo(() => parseMarkdownTable(pin.content_snapshot), [pin.content_snapshot])

  async function handleUnpin() {
    setUnpinning(true)
    try {
      await onUnpin()
    } finally {
      setUnpinning(false)
    }
  }

  async function handleCopy() {
    const fullText = pin.question_snapshot
      ? `سوال:\n${pin.question_snapshot}\n\nپاسخ:\n${pin.content_snapshot}`
      : pin.content_snapshot
    try {
      await navigator.clipboard.writeText(fullText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard API unavailable */
    }
  }

  async function handleCopyQuestion() {
    try {
      await navigator.clipboard.writeText(pin.question_snapshot)
      setQuestionCopied(true)
      setTimeout(() => setQuestionCopied(false), 2000)
    } catch {
      /* clipboard API unavailable */
    }
  }

  function handleExport() {
    if (!tableData) return
    const csv = tableToCSV(tableData.headers, tableData.rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pinned-report-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const date = new Date(pin.created_at).toLocaleDateString('fa-IR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="group rounded-lg border border-border bg-background p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">{date}</span>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={handleCopy}
            title={copied ? 'کپی شد!' : 'کپی سوال و پاسخ'}
            className={`rounded p-0.5 transition-all hover:bg-muted ${
              copied ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {copied ? <IconCheckSmall className="size-3" /> : <IconCopy className="size-3" />}
          </button>
          {tableData && (
            <button
              onClick={handleExport}
              title="دانلود CSV"
              className="rounded p-0.5 text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
            >
              <IconDownload className="size-3" />
            </button>
          )}
          <button
            onClick={handleUnpin}
            disabled={unpinning}
            title="حذف پین"
            className="rounded p-0.5 text-muted-foreground transition-all hover:bg-muted hover:text-destructive disabled:opacity-50"
          >
            <IconX className="size-3" />
          </button>
        </div>
      </div>

      {pin.question_snapshot && (
        <div className="group/q mt-1.5 flex items-start justify-between gap-2 rounded-md bg-muted/60 px-2 py-1.5">
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-foreground/70">
            <span className="font-medium text-foreground/90">سوال: </span>
            {pin.question_snapshot}
          </p>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/q:opacity-100">
            <button
              onClick={handleCopyQuestion}
              title={questionCopied ? 'کپی شد!' : 'کپی سوال'}
              className={`rounded p-0.5 transition-all hover:bg-background ${
                questionCopied ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {questionCopied ? <IconCheckSmall className="size-3" /> : <IconCopy className="size-3" />}
            </button>
            <button
              onClick={() => onAskAgain(pin.question_snapshot)}
              title="پرسیدن دوباره این سوال"
              className="rounded p-0.5 text-muted-foreground transition-all hover:bg-background hover:text-primary"
            >
              <IconRedo className="size-3" />
            </button>
          </div>
        </div>
      )}

      <div className="markdown-body mt-1.5 max-h-48 overflow-y-auto text-xs leading-relaxed text-foreground/80">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {pin.content_snapshot.slice(0, 800) + (pin.content_snapshot.length > 800 ? '…' : '')}
        </ReactMarkdown>
      </div>
    </div>
  )
}
