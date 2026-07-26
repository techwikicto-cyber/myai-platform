import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import type { DbConnectionDto } from '../api/dbConnections'
import { IconChevronDown, IconDatabase, IconTable } from './icons'

type SchemaSummary = {
  tables?: { name: string; columns?: { name: string; type: string }[] }[]
  collections?: { name: string; sample_fields?: Record<string, string> }[]
} | null

/**
 * The database tree Chat2DB keeps permanently beside the workspace. Beyond browsing,
 * clicking a table scopes the next question to it — the same selection the composer's
 * "@" picker makes, reachable from wherever the user is already looking.
 *
 * Grouped by the database segment of a qualified name, so a connection covering eight
 * accounting-year databases reads as eight groups instead of one 200-row list.
 */
export default function DatabaseTree({
  connections,
  selected,
  onToggleTable,
}: {
  connections: DbConnectionDto[]
  selected: string[]
  onToggleTable: (name: string) => void
}) {
  const [openConns, setOpenConns] = useState<Record<string, boolean>>({})
  const [openDbs, setOpenDbs] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')

  if (connections.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-sidebar-muted">
        هنوز دیتابیسی به این فضای کاری وصل نشده است.
      </p>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="p-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="جستجوی جدول…"
          dir="ltr"
          className="w-full rounded-lg border border-sidebar-border bg-sidebar-accent/60 px-2.5 py-1.5 text-xs text-sidebar-foreground outline-none placeholder:text-sidebar-muted/70 focus:border-primary"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {connections.map((conn) => (
          <ConnectionNode
            key={conn.id}
            conn={conn}
            search={search}
            open={openConns[conn.id] ?? connections.length === 1}
            onToggle={() => setOpenConns((p) => ({ ...p, [conn.id]: !(p[conn.id] ?? connections.length === 1) }))}
            openDbs={openDbs}
            setOpenDbs={setOpenDbs}
            selected={selected}
            onToggleTable={onToggleTable}
          />
        ))}
      </div>
    </div>
  )
}

function ConnectionNode({
  conn,
  search,
  open,
  onToggle,
  openDbs,
  setOpenDbs,
  selected,
  onToggleTable,
}: {
  conn: DbConnectionDto
  search: string
  open: boolean
  onToggle: () => void
  openDbs: Record<string, boolean>
  setOpenDbs: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  selected: string[]
  onToggleTable: (name: string) => void
}) {
  const navigate = useNavigate()
  const { workspaceId } = useParams<{ workspaceId: string }>()

  // A qualified name is database.schema.table; anything shorter has no database
  // segment to group by, so those fall under a single unnamed group.
  const groups = useMemo(() => {
    const summary = conn.schema_summary as SchemaSummary
    const items = summary?.tables ?? summary?.collections ?? []
    const q = search.trim().toLowerCase()
    const map = new Map<string, string[]>()
    for (const item of items) {
      if (q && !item.name.toLowerCase().includes(q)) continue
      const parts = item.name.split('.')
      const dbName = parts.length >= 3 ? parts[0] : ''
      if (!map.has(dbName)) map.set(dbName, [])
      map.get(dbName)!.push(item.name)
    }
    return [...map.entries()]
  }, [conn.schema_summary, search])

  const total = groups.reduce((n, [, list]) => n + list.length, 0)
  // Searching should reveal hits without making the user expand everything by hand.
  const expanded = open || search.trim().length > 0

  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60"
      >
        <IconChevronDown className={clsx('size-3 shrink-0 transition-transform', !expanded && '-rotate-90')} />
        <IconDatabase className="size-3.5 shrink-0 text-sidebar-muted" />
        <span className="min-w-0 flex-1 truncate text-right">{conn.name}</span>
        <span className="shrink-0 text-[10px] text-sidebar-muted">{total}</span>
      </button>

      {expanded &&
        groups.map(([dbName, tables]) => {
          const key = `${conn.id}:${dbName}`
          const dbOpen = openDbs[key] ?? (groups.length === 1 || search.trim().length > 0)
          return (
            <div key={key} className="mr-3 border-r border-sidebar-border/50 pr-1">
              {dbName && (
                <button
                  onClick={() => setOpenDbs((p) => ({ ...p, [key]: !dbOpen }))}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-sidebar-muted transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                >
                  <IconChevronDown className={clsx('size-2.5 shrink-0 transition-transform', !dbOpen && '-rotate-90')} />
                  <span className="min-w-0 flex-1 truncate text-right" dir="ltr">
                    {dbName}
                  </span>
                  <span className="shrink-0 text-[10px]">{tables.length}</span>
                </button>
              )}
              {dbOpen &&
                tables.map((name) => {
                  const isSelected = selected.includes(name)
                  return (
                    <div
                      key={name}
                      className={clsx(
                        'group/tbl flex items-center gap-1 rounded-md pl-1 transition-colors',
                        isSelected
                          ? 'bg-primary-soft text-primary'
                          : 'text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                      )}
                    >
                      <button
                        onClick={() => navigate(`/workspace/${workspaceId}/table/${conn.id}/${encodeURIComponent(name)}`)}
                        title={`${name}\nکلیک: باز کردن داده‌های جدول`}
                        className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-1 text-[11px]"
                      >
                        <IconTable className="size-3 shrink-0 opacity-60" />
                        <span className="min-w-0 flex-1 truncate text-right" dir="ltr">
                          {name.split('.').pop()}
                        </span>
                      </button>
                      <button
                        onClick={() => onToggleTable(name)}
                        title={isSelected ? 'حذف از دامنه‌ی سؤال' : 'افزودن به دامنه‌ی سؤال بعدی'}
                        className={clsx(
                          'shrink-0 rounded px-1 text-[11px] font-bold transition-opacity',
                          isSelected ? 'opacity-100' : 'opacity-0 group-hover/tbl:opacity-100',
                        )}
                      >
                        @
                      </button>
                    </div>
                  )
                })}
            </div>
          )
        })}
    </div>
  )
}
