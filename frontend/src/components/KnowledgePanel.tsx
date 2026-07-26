import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  knowledgeApi,
  KNOWLEDGE_KINDS,
  type KnowledgeEntryDto,
  type KnowledgeKind,
} from '../api/knowledge'
import type { DbConnectionDto } from '../api/dbConnections'
import { Button, Card, CardHeader, Field, Input, Select, Spinner, Textarea } from './ui'
import { IconPlus, IconTrash } from './icons'

/**
 * Workspace knowledge base — the layer that teaches the assistant what this
 * organization's words mean. Modelled on Chat2DB's knowledge management (terms /
 * business logic / SQL templates): the schema tells the model a column is called
 * acc_Level, only this tells it that level 1 means «حساب کل».
 */
export default function KnowledgePanel({
  workspaceId,
  connections,
}: {
  workspaceId: string
  connections: DbConnectionDto[]
}) {
  const [kind, setKind] = useState<KnowledgeKind>('term')
  const [entries, setEntries] = useState<KnowledgeEntryDto[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [connectionId, setConnectionId] = useState('')

  const active = KNOWLEDGE_KINDS.find((k) => k.value === kind)!

  const reload = useCallback(() => {
    setLoading(true)
    knowledgeApi
      .list(workspaceId, kind)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }, [workspaceId, kind])

  useEffect(reload, [reload])

  function resetForm() {
    setName('')
    setContent('')
    setConnectionId('')
    setAdding(false)
  }

  async function handleSave() {
    if (!name.trim() || !content.trim()) return
    setSaving(true)
    try {
      await knowledgeApi.create(workspaceId, {
        kind,
        name: name.trim(),
        content: content.trim(),
        db_connection_id: connectionId || null,
      })
      resetForm()
      reload()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    await knowledgeApi.remove(workspaceId, id)
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  return (
    <Card>
      <CardHeader
        title="دانش سازمانی"
        description="به دستیار یاد بدهید اصطلاحات و قواعد سازمان شما یعنی چه — بیشترین تأثیر را روی دقت پاسخ‌ها دارد"
        action={
          !adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <IconPlus />
              افزودن
            </Button>
          )
        }
      />
      <div className="p-6">
        <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-muted/60 p-1">
          {KNOWLEDGE_KINDS.map((k) => (
            <button
              key={k.value}
              onClick={() => {
                setKind(k.value)
                resetForm()
              }}
              className={clsx(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                kind === k.value
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {k.label}
            </button>
          ))}
        </div>

        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{active.description}</p>

        {adding && (
          <div className="mb-4 space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <Field label="عنوان">
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={active.namePlaceholder}
              />
            </Field>
            <Field label="توضیح">
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={kind === 'sql_template' ? 8 : 4}
                placeholder={active.contentPlaceholder}
                className={clsx('resize-none', kind === 'sql_template' && 'font-mono text-xs')}
                dir={kind === 'sql_template' ? 'ltr' : undefined}
              />
            </Field>
            {connections.length > 0 && (
              <Field
                label="محدود به اتصال دیتابیس"
                hint="اگر خالی بماند، برای همه‌ی اتصال‌های این فضای کاری اعمال می‌شود"
              >
                <Select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
                  <option value="">همه‌ی اتصال‌ها</option>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSave} disabled={saving || !name.trim() || !content.trim()}>
                {saving && <Spinner />}
                ذخیره
              </Button>
              <Button size="sm" variant="ghost" onClick={resetForm} disabled={saving}>
                انصراف
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            هنوز موردی ثبت نشده است.
          </p>
        ) : (
          <ul className="space-y-2">
            {entries.map((e) => (
              <li
                key={e.id}
                className="group flex items-start justify-between gap-3 rounded-lg border border-border bg-background p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{e.name}</p>
                  <p
                    className={clsx(
                      'mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground',
                      e.kind === 'sql_template' && 'font-mono',
                    )}
                    dir={e.kind === 'sql_template' ? 'ltr' : undefined}
                  >
                    {e.content}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(e.id)}
                  title="حذف"
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground/50 opacity-0 transition-all hover:bg-destructive-soft hover:text-destructive group-hover:opacity-100"
                >
                  <IconTrash />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
