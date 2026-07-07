import { useEffect, useState } from 'react'
import { workspacesApi } from '../api/workspaces'
import type { Workspace } from '../types'
import { Button, Spinner } from './ui'
import { IconGlobe } from './icons'

interface Props {
  currentWorkspaceId: string
  currentSharedIds: string[]
  resourceName: string
  onSave: (workspaceIds: string[]) => Promise<void>
  onClose: () => void
}

export default function ShareModal({ currentWorkspaceId, currentSharedIds, resourceName, onSave, onClose }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set(currentSharedIds))
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    workspacesApi.list().then((ws) => {
      setWorkspaces(ws.filter((w) => w.id !== currentWorkspaceId))
      setLoading(false)
    })
  }, [currentWorkspaceId])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave([...selected])
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <IconGlobe />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">اشتراک‌گذاری</h2>
            <p className="text-sm text-muted-foreground line-clamp-1">«{resourceName}»</p>
          </div>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          با کدام فضاهای کاری به اشتراک گذاشته شود؟ (فضاهای انتخاب‌شده به محتوا دسترسی می‌یابند)
        </p>

        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : workspaces.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">فضای کاری دیگری در سیستم وجود ندارد</p>
        ) : (
          <ul className="mb-5 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {workspaces.map((ws) => (
              <li key={ws.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={selected.has(ws.id)}
                    onChange={() => toggle(ws.id)}
                    className="size-4 accent-primary"
                  />
                  <span className="text-sm font-medium text-foreground">{ws.name}</span>
                  {selected.has(ws.id) && (
                    <span className="mr-auto text-xs text-primary">انتخاب شد</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-3">
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving && <Spinner />}
            ذخیره
          </Button>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
          {selected.size > 0 && (
            <span className="mr-auto flex items-center text-xs text-muted-foreground">
              {selected.size} فضا انتخاب شده
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
