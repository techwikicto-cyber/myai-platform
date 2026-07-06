import type { ReactNode } from 'react'
import { IconSparkles } from './icons'

export default function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-muted/50 p-4">
      {/* animated ambient blobs */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="animate-blob absolute -top-24 right-1/4 size-96 rounded-full bg-primary/15 blur-3xl" />
        <div
          className="animate-blob absolute -bottom-32 left-1/4 size-[28rem] rounded-full bg-emerald-300/20 blur-3xl"
          style={{ animationDelay: '-7s' }}
        />
      </div>

      <div className="animate-fade-up relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <IconSparkles className="size-6" />
          </div>
          <h1 className="text-xl font-bold text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="rounded-xl border border-border bg-card/90 p-6 shadow-lg backdrop-blur-sm">{children}</div>
      </div>
    </div>
  )
}
