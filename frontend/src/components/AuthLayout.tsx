import type { ReactNode } from 'react'
import OwlLogo from './Logo'

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
      {/* animated grid background */}
      <div className="bg-grid-pattern pointer-events-none absolute inset-0" aria-hidden />

      {/* animated ambient blobs */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="animate-blob absolute -top-24 right-1/4 size-96 rounded-full bg-primary/15 blur-3xl" />
        <div
          className="animate-blob absolute -bottom-32 left-1/4 size-[28rem] rounded-full bg-orange-200/25 blur-3xl"
          style={{ animationDelay: '-7s' }}
        />
      </div>

      <div className="animate-fade-up relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <OwlLogo className="mb-3 size-16 shrink-0" />
          <h1 className="text-xl font-bold text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="rounded-xl border border-border bg-card/90 p-6 shadow-lg backdrop-blur-sm">{children}</div>
      </div>
    </div>
  )
}
