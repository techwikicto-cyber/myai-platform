import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { ChatMessage } from '../types'
import { IconCheckSmall, IconCopy, IconEdit, IconSparkles } from './icons'

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
}: {
  message: ChatMessage
  onEdit?: () => void
}) {
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
          {/* Action buttons — visible on hover */}
          <div className="flex items-center gap-0.5 px-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
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

  return (
    <div className="animate-fade-up flex w-full justify-end">
      <div className="group flex flex-col items-end gap-0.5">
        <div className="flex max-w-[80%] items-start gap-2.5">
          <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2.5 text-sm leading-relaxed text-foreground shadow-sm">
            {showTyping ? (
              <TypingDots />
            ) : (
              <div className="markdown-body [&_hr]:my-3 [&_hr]:border-border">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <IconSparkles />
          </div>
        </div>
        {/* Action buttons — visible on hover, only after content arrives */}
        {!showTyping && !message.pending && (
          <div className="flex items-center gap-0.5 px-9 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <CopyButton content={message.content} />
          </div>
        )}
      </div>
    </div>
  )
}
