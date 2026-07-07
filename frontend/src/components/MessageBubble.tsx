import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { ChatMessage } from '../types'
import { IconSparkles } from './icons'

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="در حال نوشتن">
      <span className="typing-dot inline-block size-1.5 rounded-full bg-muted-foreground" />
      <span className="typing-dot inline-block size-1.5 rounded-full bg-muted-foreground" />
      <span className="typing-dot inline-block size-1.5 rounded-full bg-muted-foreground" />
    </span>
  )
}

export default function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="animate-fade-up flex w-full justify-start">
        <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-md shadow-primary/15">
          <div className="markdown-body [&_code]:bg-white/20 [&_pre]:border-white/20 [&_pre]:bg-white/10">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        </div>
      </div>
    )
  }

  const showTyping = message.pending && !message.content

  return (
    <div className="animate-fade-up flex w-full justify-end">
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
    </div>
  )
}
