import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import clsx from 'clsx'
import { API_BASE } from '../api/client'
import { chatApi, streamMessage, type ChatMode } from '../api/chat'
import { pinsApi } from '../api/pins'
import { workspacesApi } from '../api/workspaces'
import { documentsApi, type DocumentDto } from '../api/documents'
import { dbConnectionsApi, type DbConnectionDto, ENGINE_LABELS } from '../api/dbConnections'
import MessageBubble from '../components/MessageBubble'
import { Alert, Badge } from '../components/ui'
import {
  IconCheckSmall,
  IconChat,
  IconChevronDown,
  IconCopy,
  IconDatabase,
  IconDocument,
  IconDownload,
  IconMic,
  IconPin,
  IconRedo,
  IconSend,
  IconStop,
  IconX,
} from '../components/icons'
import { parseMarkdownTable, tableToCSV } from '../components/MiniChart'
import { copyText } from '../lib/clipboard'
import { useThreadStore } from '../store/threads'
import { useChatStore } from '../store/chat'
import { useAuthStore } from '../store/auth'
import type { ChatMessage, PinDto, Workspace } from '../types'

export default function WorkspacePage() {
  const { workspaceId, threadId } = useParams<{ workspaceId: string; threadId?: string }>()
  const navigate = useNavigate()
  const threadStore = useThreadStore()

  const { messages: msgsMap, input: inpsMap, sending: sendMap, error: errMap, mode: modeMap, tables: tablesMap, setMessages, setInput, setSending, setError, setMode, setTables } = useChatStore()

  const messages = threadId ? (msgsMap[threadId] || []) : []
  const input = threadId ? (inpsMap[threadId] || '') : ''
  const sending = threadId ? (sendMap[threadId] || false) : false
  const error = threadId ? (errMap[threadId] || '') : ''
  const mode: ChatMode = threadId ? (modeMap[threadId] || 'auto') : 'auto'
  const scopedTables = useMemo(() => (threadId ? tablesMap[threadId] || [] : []), [threadId, tablesMap])

  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [pins, setPins] = useState<PinDto[]>([])
  const [showPins, setShowPins] = useState(false)
  const [documents, setDocuments] = useState<DocumentDto[]>([])
  const [dbConnections, setDbConnections] = useState<DbConnectionDto[]>([])
  const [showSources, setShowSources] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const currentThreadTitleRef = useRef<string>('گفتگوی جدید')

  const pinnedMessageIds = useMemo(() => new Set(pins.map((p) => p.message_id)), [pins])

  // Flat list of every table/collection across connected databases, for the "@" picker.
  const allTableNames = useMemo(() => {
    const names: string[] = []
    for (const c of dbConnections) {
      const s = c.schema_summary as SchemaSummary
      for (const item of s?.tables ?? s?.collections ?? []) names.push(item.name)
    }
    return names
  }, [dbConnections])

  // Starter prompts, derived from what this workspace actually has rather than a fixed
  // list — a suggestion referencing a table that doesn't exist is worse than none.
  const starterQuestions = useMemo(() => {
    const qs: string[] = []
    if (dbConnections.length > 0) {
      qs.push('چه جدول‌هایی در دسترس داری؟')
      const sample = allTableNames[0]?.split('.').pop()
      if (sample) qs.push(`ستون‌های جدول ${sample} چیست؟`)
      qs.push('ساختار و روابط بین جدول‌ها را توضیح بده')
    }
    if (documents.length > 0) qs.push('خلاصه‌ای از اسناد این فضای کاری بده')
    return qs
  }, [dbConnections, documents, allTableNames])

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

  // Load connected sources (documents + databases) so the sidebar can show exactly
  // what this workspace can answer from — same idea as AnythingLLM's always-visible
  // source list, so users never have to ask the model what's connected.
  useEffect(() => {
    if (!workspaceId) return
    documentsApi.list(workspaceId).then(setDocuments).catch(() => {})
    dbConnectionsApi.list(workspaceId).then(setDbConnections).catch(() => {})
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

    // Thread ID is known — load its messages if we haven't already
    currentThreadTitleRef.current = 'گفتگوی جدید'
    
    // Only fetch if we have no messages in the global store, meaning it's a fresh load
    if (!msgsMap[threadId]) {
      chatApi.listMessages(threadId).then((msgs) => {
        if (!cancelled) {
          setMessages(threadId, msgs)
          // Infer current thread title
          const threadInStore = (threadStore.threadsByWs[workspaceId] || []).find((t) => t.id === threadId)
          if (threadInStore) currentThreadTitleRef.current = threadInStore.title
        }
      })
    } else {
      const threadInStore = (threadStore.threadsByWs[workspaceId] || []).find((t) => t.id === threadId)
      if (threadInStore) currentThreadTitleRef.current = threadInStore.title
    }

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
    setError(threadId, '')
    const userText = input.trim()
    setInput(threadId, '')
    setSending(threadId, true)

    const userMsg: ChatMessage = { id: `tmp-user-${Date.now()}`, role: 'user', content: userText }
    const assistantMsg: ChatMessage = { id: `tmp-assistant-${Date.now()}`, role: 'assistant', content: '', pending: true }
    setMessages(threadId, (prev) => [...prev, userMsg, assistantMsg])

    const controller = new AbortController()
    abortControllerRef.current = controller
    const tmpAssistantId = assistantMsg.id

    // Use a captured reference to threadId so that if the component unmounts,
    // the callback still knows which thread to update in the global store.
    const currentThreadId = threadId

    try {
      await streamMessage(currentThreadId, userText, (event) => {
        if (event.type === 'token') {
          setMessages(currentThreadId, (prev) =>
            prev.map((m) => (m.id === tmpAssistantId ? { ...m, content: m.content + event.content, pending: false } : m)),
          )
        } else if (event.type === 'done') {
          // Replace temp ID with real backend ID and attach export links
          setMessages(currentThreadId, (prev) =>
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
          setError(currentThreadId, event.message)
        }
      }, controller.signal, mode, scopedTables)
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setError(currentThreadId, err instanceof Error ? err.message : 'خطا در دریافت پاسخ')
      }
    } finally {
      abortControllerRef.current = null
      setSending(currentThreadId, false)
      setMessages(currentThreadId, (prev) =>
        prev.map((m) => (m.id === tmpAssistantId && m.pending ? { ...m, pending: false } : m)),
      )
    }
  }

  function handleStop() {
    abortControllerRef.current?.abort()
  }

  async function handleExportResources() {
    if (!workspaceId) return
    const token = useAuthStore.getState().token
    const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/resources/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'resources.md'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleEdit = useCallback((msgId: string, content: string) => {
    if (!threadId) return
    setMessages(threadId, (prev) => {
      const idx = prev.findIndex((m) => m.id === msgId)
      return idx === -1 ? prev : prev.slice(0, idx)
    })
    setInput(threadId, content)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [threadId, setMessages, setInput])

  // useCallback + reading messages imperatively (not via the `messages` closure, which
  // gets a new array on every streaming token) keeps this reference stable across a
  // streaming response, so passing it to memoized MessageBubbles actually prevents
  // re-rendering every other bubble in the thread on every token.
  const handlePin = useCallback(async (messageId: string, content: string) => {
    if (!threadId) return
    if (pinnedMessageIds.has(messageId)) {
      const pin = pins.find((p) => p.message_id === messageId)
      if (pin) {
        await pinsApi.delete(pin.id)
        setPins((prev) => prev.filter((p) => p.id !== pin.id))
      }
    } else {
      const currentMessages = useChatStore.getState().messages[threadId] || []
      const idx = currentMessages.findIndex((m) => m.id === messageId)
      let question = ''
      for (let i = idx - 1; i >= 0; i--) {
        if (currentMessages[i].role === 'user') {
          question = currentMessages[i].content
          break
        }
      }
      const newPin = await pinsApi.create(messageId, question, content)
      setPins((prev) => [newPin, ...prev])
    }
  }, [threadId, pinnedMessageIds, pins])

  function handleAskAgain(question: string) {
    if (threadId) {
      setInput(threadId, question)
      setTimeout(() => textareaRef.current?.focus(), 0)
    }
  }

  if (!workspaceId) return null

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
        <h2 className="text-sm font-semibold text-foreground">{workspace?.name}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowSources((v) => !v)
              setShowPins(false)
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${
              showSources
                ? 'bg-primary-soft text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <IconDatabase />
            منابع
          </button>
          <button
            onClick={() => {
              setShowPins((v) => !v)
              setShowSources(false)
            }}
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
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Chat area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl space-y-4 px-6 py-6">
            {messages.length === 0 && !error && (
              <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <IconChat className="size-6" />
                </div>
                <p className="text-sm text-muted-foreground">
                  سوال خود را بپرسید — پاسخ بر اساس اسناد و داده‌های این فضای کاری داده می‌شود.
                </p>
                {/* Chat2DB-style starter prompts: with a large schema users often don't
                    know where to begin, and a bad first question wastes a slow turn. */}
                {starterQuestions.length > 0 && (
                  <div className="mt-2 flex w-full max-w-2xl flex-col gap-2">
                    <span className="text-[11px] font-medium text-muted-foreground/70">
                      پیشنهاد برای شروع
                    </span>
                    <div className="flex flex-wrap justify-center gap-2">
                      {starterQuestions.map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => {
                            if (!threadId) return
                            setInput(threadId, q)
                            setTimeout(() => textareaRef.current?.focus(), 0)
                          }}
                          className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground/80 transition-colors hover:border-primary/40 hover:bg-primary-soft hover:text-primary"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onEdit={m.role === 'user' ? handleEdit : undefined}
                isPinned={pinnedMessageIds.has(m.id)}
                onPin={m.role === 'assistant' ? handlePin : undefined}
              />
            ))}
          </div>
        </div>

        {/* Sources panel — shows exactly what this workspace can answer from, so users
            never have to ask the model "what documents/databases do you have". */}
        {showSources && (
          <div className="flex w-80 shrink-0 flex-col border-r border-border bg-card">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <div className="flex items-center gap-2">
                <IconDatabase className="text-primary" />
                <span className="text-sm font-semibold">منابع این فضای کاری</span>
              </div>
              <button
                onClick={() => setShowSources(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <IconX />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <IconDocument className="size-3.5" />
                  اسناد ({documents.length})
                </h3>
                {documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">هیچ سندی آپلود نشده است.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {documents.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5">
                        <span className="truncate text-sm text-foreground" title={d.filename} dir="ltr">
                          {d.filename}
                        </span>
                        {d.status !== 'ready' && (
                          <Badge kind={d.status === 'failed' ? 'error' : 'warning'}>
                            {d.status === 'failed' ? 'خطا' : d.status === 'processing' ? 'پردازش' : 'در صف'}
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <IconDatabase className="size-3.5" />
                  دیتابیس‌ها ({dbConnections.length})
                </h3>
                {dbConnections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">هیچ دیتابیسی وصل نشده است.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {dbConnections.map((c) => (
                      <DbConnectionExplorerItem key={c.id} connection={c} />
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="border-t border-border p-3">
              <button
                onClick={handleExportResources}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <IconDownload className="size-3.5" />
                دانلود فهرست کامل (Markdown)
              </button>
            </div>
          </div>
        )}

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
        <div className="mx-auto max-w-5xl">
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
                onChange={(e) => threadId && setInput(threadId, e.target.value)}
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
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1">
              <div className="flex flex-wrap items-center gap-2">
                {dbConnections.length > 0 && (
                  <>
                    <ChatModeSelector
                      value={mode}
                      onChange={(m) => threadId && setMode(threadId, m)}
                      disabled={sending}
                    />
                    <TableScopePicker
                      allTables={allTableNames}
                      selected={scopedTables}
                      onChange={(t) => threadId && setTables(threadId, t)}
                      disabled={sending}
                    />
                  </>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground/70">
                Enter برای ارسال — Shift+Enter برای خط جدید
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// Chat2DB-style explicit intent selection: the user states what kind of question this
// is instead of the model having to infer it from wording. Only shown when the
// workspace actually has a database connected — with documents only there is nothing
// to choose between.
const CHAT_MODES: { value: ChatMode; label: string; title: string }[] = [
  { value: 'auto', label: 'خودکار', title: 'مدل خودش تصمیم می‌گیرد که کوئری بزند یا از اسناد پاسخ دهد' },
  { value: 'query', label: 'کوئری روی دیتابیس', title: 'حتماً روی دیتابیس کوئری اجرا می‌شود؛ پاسخ بدون کوئری پذیرفته نمی‌شود' },
  { value: 'chat', label: 'گفتگو و اسناد', title: 'بدون کوئری؛ پاسخ فقط از روی اسکیما و اسناد این فضای کاری' },
]

function ChatModeSelector({
  value,
  onChange,
  disabled,
}: {
  value: ChatMode
  onChange: (mode: ChatMode) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5" role="group" aria-label="حالت پاسخ‌دهی">
      {CHAT_MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          onClick={() => onChange(m.value)}
          disabled={disabled}
          title={m.title}
          aria-pressed={value === m.value}
          className={clsx(
            'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50',
            value === m.value
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Chat2DB's "@" table-mention, adapted: scope a question to specific tables instead of
 * sending the model the whole schema. With ~200 tables in context the model has to
 * guess which are relevant; naming the two or three that matter is the single biggest
 * accuracy lever the UI can offer.
 */
function TableScopePicker({
  allTables,
  selected,
  onChange,
  disabled,
}: {
  allTables: string[]
  selected: string[]
  onChange: (tables: string[]) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    const pool = q ? allTables.filter((t) => t.toLowerCase().includes(q)) : allTables
    return pool.slice(0, 50)
  }, [allTables, search])

  function toggle(name: string) {
    onChange(selected.includes(name) ? selected.filter((t) => t !== name) : [...selected, name])
  }

  if (allTables.length === 0) return null

  return (
    <div className="relative flex flex-wrap items-center gap-1.5" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title="محدود کردن سوال به جدول‌های مشخص — دقت پاسخ را زیاد بالا می‌برد"
        className={clsx(
          'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50',
          selected.length > 0
            ? 'border-primary/40 bg-primary-soft text-primary'
            : 'border-border bg-card text-muted-foreground hover:text-foreground',
        )}
      >
        <span className="font-bold">@</span>
        {selected.length > 0 ? `${selected.length} جدول` : 'انتخاب جدول'}
      </button>

      {selected.map((name) => (
        <span
          key={name}
          className="inline-flex max-w-[220px] items-center gap-1 rounded-md bg-primary-soft px-2 py-0.5 text-[11px] text-primary"
        >
          <span className="truncate" dir="ltr" title={name}>
            {name.split('.').pop()}
          </span>
          <button
            type="button"
            onClick={() => toggle(name)}
            disabled={disabled}
            title="حذف از دامنه"
            className="shrink-0 opacity-70 hover:opacity-100"
          >
            <IconX className="size-3" />
          </button>
        </span>
      ))}

      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-2 w-80 rounded-xl border border-border bg-card p-2 shadow-lg">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجوی نام جدول…"
            dir="ltr"
            className="mb-2 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
          />
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {matches.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">جدولی پیدا نشد</p>
            ) : (
              matches.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggle(name)}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-right text-xs transition-colors',
                    selected.includes(name)
                      ? 'bg-primary-soft text-primary'
                      : 'text-foreground/80 hover:bg-muted',
                  )}
                >
                  <span
                    className={clsx(
                      'flex size-3.5 shrink-0 items-center justify-center rounded border',
                      selected.includes(name) ? 'border-primary bg-primary text-white' : 'border-border',
                    )}
                  >
                    {selected.includes(name) && <IconCheckSmall className="size-2.5" />}
                  </span>
                  <span className="truncate" dir="ltr" title={name}>
                    {name}
                  </span>
                </button>
              ))
            )}
          </div>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-2 w-full rounded-md py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              پاک کردن همه
            </button>
          )}
        </div>
      )}
    </div>
  )
}

type SchemaColumn = { name: string; type: string }
type SchemaTable = { name: string; columns?: SchemaColumn[] }
type SchemaCollection = { name: string; sample_fields?: Record<string, string> }
type SchemaSummary = { tables?: SchemaTable[]; collections?: SchemaCollection[] } | null

function DbConnectionExplorerItem({ connection }: { connection: DbConnectionDto }) {
  const [expanded, setExpanded] = useState(false)
  const summary = connection.schema_summary as SchemaSummary
  const isCollections = !summary?.tables && !!summary?.collections
  const items = summary?.tables ?? summary?.collections ?? []

  return (
    <li className="rounded-lg bg-muted/50">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-right"
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-medium text-foreground">
          <IconChevronDown className={clsx('size-3 shrink-0 transition-transform', !expanded && '-rotate-90')} />
          <span className="truncate">{connection.name}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {items.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {items.length} {isCollections ? 'مجموعه' : 'جدول'}
            </span>
          )}
          <Badge kind="info">{ENGINE_LABELS[connection.engine]}</Badge>
        </div>
      </button>
      {expanded && (
        <div className="space-y-0.5 border-t border-border px-2.5 py-1.5">
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">اسکیمایی کشف نشده است — از تنظیمات اتصال، فهرست را بروزرسانی کنید.</p>
          ) : (
            items.map((item) => <DbTableExplorerItem key={item.name} item={item} />)
          )}
        </div>
      )}
    </li>
  )
}

function DbTableExplorerItem({ item }: { item: SchemaTable | SchemaCollection }) {
  const [open, setOpen] = useState(false)
  const columns: SchemaColumn[] =
    'columns' in item && item.columns
      ? item.columns
      : 'sample_fields' in item && item.sample_fields
        ? Object.entries(item.sample_fields).map(([name, type]) => ({ name, type }))
        : []

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={columns.length === 0}
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-xs text-foreground/80 transition-colors hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
      >
        <IconChevronDown
          className={clsx('size-2.5 shrink-0 transition-transform', (!open || columns.length === 0) && '-rotate-90', columns.length === 0 && 'opacity-30')}
        />
        <span className="truncate" dir="ltr" title={item.name}>
          {item.name}
        </span>
      </button>
      {open && columns.length > 0 && (
        <ul className="mb-1 mr-4 space-y-0.5 border-r border-border pr-2">
          {columns.map((col) => (
            <li key={col.name} className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground" dir="ltr">
              <span className="truncate">{col.name}</span>
              <span className="shrink-0 text-muted-foreground/70">{col.type}</span>
            </li>
          ))}
        </ul>
      )}
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
  const [answerCopied, setAnswerCopied] = useState(false)

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
    if (await copyText(fullText)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  async function handleCopyQuestion() {
    if (await copyText(pin.question_snapshot)) {
      setQuestionCopied(true)
      setTimeout(() => setQuestionCopied(false), 2000)
    }
  }

  async function handleCopyAnswer() {
    if (await copyText(pin.content_snapshot)) {
      setAnswerCopied(true)
      setTimeout(() => setAnswerCopied(false), 2000)
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

      <div className="group/a mt-1.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-medium text-foreground/90">پاسخ:</span>
          <button
            onClick={handleCopyAnswer}
            title={answerCopied ? 'کپی شد!' : 'کپی پاسخ'}
            className={`rounded p-0.5 opacity-0 transition-all hover:bg-muted group-hover/a:opacity-100 ${
              answerCopied ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {answerCopied ? <IconCheckSmall className="size-3" /> : <IconCopy className="size-3" />}
          </button>
        </div>
        <div className="markdown-body max-h-48 overflow-y-auto text-xs leading-relaxed text-foreground/80">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {pin.content_snapshot.slice(0, 800) + (pin.content_snapshot.length > 800 ? '…' : '')}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
