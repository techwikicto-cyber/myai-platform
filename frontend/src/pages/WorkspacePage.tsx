import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { chatApi, streamMessage } from '../api/chat'
import { workspacesApi } from '../api/workspaces'
import MessageBubble from '../components/MessageBubble'
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
    init().catch((err) => setError(err instanceof Error ? err.message : 'خطا در بارگذاری ورک‌اسپیس'))

    return () => {
      cancelled = true
    }
  }, [workspaceId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || !threadId || sending) return
    setError('')
    const userText = input.trim()
    setInput('')
    setSending(true)

    const userMsg: ChatMessage = { id: `tmp-user-${Date.now()}`, role: 'user', content: userText }
    const assistantMsg: ChatMessage = { id: `tmp-assistant-${Date.now()}`, role: 'assistant', content: '', pending: true }
    setMessages((prev) => [...prev, userMsg, assistantMsg])

    try {
      await streamMessage(threadId, userText, (event) => {
        if (event.type === 'token') {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: m.content + event.content, pending: false } : m)),
          )
        } else if (event.type === 'error') {
          setError(event.message)
        }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت پاسخ')
    } finally {
      setSending(false)
    }
  }

  if (!workspaceId) return null

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800 px-6 py-3">
        <h2 className="text-sm font-medium text-zinc-200">{workspace?.name}</h2>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            پیامی وجود ندارد. یک سوال بپرس تا شروع کنیم.
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>

      {error && <p className="px-6 pb-2 text-xs text-red-400">{error}</p>}

      <form onSubmit={handleSend} className="border-t border-zinc-800 p-4">
        <div className="flex items-end gap-2 rounded-xl border border-zinc-700 bg-zinc-800 p-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend(e)
              }
            }}
            rows={1}
            placeholder="پیام خود را بنویسید..."
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            ارسال
          </button>
        </div>
      </form>
    </div>
  )
}
