import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { chatApi, streamMessage } from '../api/chat'
import { workspacesApi } from '../api/workspaces'
import MessageBubble from '../components/MessageBubble'
import { Alert } from '../components/ui'
import { IconChat, IconMic, IconSend, IconSettings, IconStop } from '../components/icons'
import type { ChatMessage, Workspace } from '../types'

export default function WorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false

    async function init() {
      const ws = await workspacesApi.get(workspaceId!)
      if (cancelled) return
      setWorkspace(ws)

      const threads = await chatApi.listThreads(workspaceId!)
      let activeThreadId: string
      if (threads.length > 0) {
        activeThreadId = threads[0].id
      } else {
        const created = await chatApi.createThread(workspaceId!)
        activeThreadId = created.id
      }
      if (cancelled) return
      setThreadId(activeThreadId)

      const msgs = await chatApi.listMessages(activeThreadId)
      if (!cancelled) setMessages(msgs)
    }

    setMessages([])
    setThreadId(null)
    setError('')
    init().catch((err) => setError(err instanceof Error ? err.message : 'خطا در بارگذاری فضای کاری'))

    return () => {
      cancelled = true
      abortControllerRef.current?.abort()
    }
  }, [workspaceId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // Auto-resize textarea as content grows
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

    try {
      await streamMessage(threadId, userText, (event) => {
        if (event.type === 'token') {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: m.content + event.content, pending: false } : m)),
          )
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
        prev.map((m) => (m.id === assistantMsg.id && m.pending ? { ...m, pending: false } : m)),
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

  if (!workspaceId) return null

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
        <h2 className="text-sm font-semibold text-foreground">{workspace?.name}</h2>
        {workspace?.is_manager && (
          <Link
            to={`/workspace/${workspaceId}/settings`}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <IconSettings />
            تنظیمات فضای کاری
          </Link>
        )}
      </header>

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
            />
          ))}
        </div>
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

              {/* Voice — coming soon */}
              <button
                type="button"
                disabled
                title="بزودی — ارسال پیام صوتی"
                className="flex size-9 cursor-not-allowed items-center justify-center rounded-lg text-muted-foreground/30 transition-colors"
              >
                <IconMic />
              </button>

              {/* Stop / Send */}
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
