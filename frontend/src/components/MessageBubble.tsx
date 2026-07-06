import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import clsx from 'clsx'
import type { ChatMessage } from '../types'
import { IconSparkles } from './icons'

export default function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex w-full justify-start">
        <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm">
          <div className="markdown-body [&_code]:bg-white/20 [&_pre]:border-white/20 [&_pre]:bg-white/10">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full justify-end">
      <div className="flex max-w-[80%] items-start gap-2.5">
        <div
          className={clsx(
            'rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2.5 text-sm leading-relaxed text-foreground shadow-sm',
            message.pending && 'animate-pulse text-muted-foreground',
          )}
        >
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {message.content || (message.pending ? 'در حال فکر کردن…' : '')}
            </ReactMarkdown>
          </div>
        </div>
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
          <IconSparkles />
        </div>
      </div>
    </div>
  )
}
