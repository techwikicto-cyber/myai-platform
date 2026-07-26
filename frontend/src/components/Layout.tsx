import { useEffect, useState } from 'react'
import { Outlet, useMatch } from 'react-router-dom'
import clsx from 'clsx'
import NavRail from './NavRail'
import Sidebar from './Sidebar'
import DatabaseTree from './DatabaseTree'
import ProfileModal from './ProfileModal'
import { useAuthStore } from '../store/auth'
import { useChatStore } from '../store/chat'
import { dbConnectionsApi, type DbConnectionDto } from '../api/dbConnections'
import { IconChat, IconDatabase } from './icons'

/**
 * Chat2DB's three-column shell: icon rail, a context panel, then the content area.
 * The panel switches between the conversation list and the database tree rather than
 * stacking both, which is what keeps a 200-table schema from crowding out navigation.
 */
export default function Layout() {
  const { user } = useAuthStore()
  const [panel, setPanel] = useState<'chats' | 'tables'>('chats')
  const [connections, setConnections] = useState<DbConnectionDto[]>([])

  const wsMatch = useMatch('/workspace/:workspaceId/*')
  const threadMatch = useMatch('/workspace/:workspaceId/thread/:threadId')
  const workspaceId = wsMatch?.params.workspaceId ?? null
  const threadId = threadMatch?.params.threadId ?? null

  const tablesMap = useChatStore((s) => s.tables)
  const setTables = useChatStore((s) => s.setTables)
  const selected = threadId ? tablesMap[threadId] || [] : []

  useEffect(() => {
    if (!workspaceId) {
      setConnections([])
      return
    }
    dbConnectionsApi.list(workspaceId).then(setConnections).catch(() => setConnections([]))
  }, [workspaceId])

  // The table view is only meaningful inside a workspace that has a database.
  const canShowTables = Boolean(workspaceId) && connections.length > 0
  const activePanel = canShowTables ? panel : 'chats'

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <NavRail />

      <div className="flex w-64 shrink-0 flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground">
        {canShowTables && (
          <div className="flex gap-1 border-b border-sidebar-border p-2">
            {[
              { key: 'chats' as const, label: 'گفتگوها', icon: <IconChat className="size-3.5" /> },
              { key: 'tables' as const, label: 'جدول‌ها', icon: <IconDatabase className="size-3.5" /> },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setPanel(t.key)}
                className={clsx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors',
                  activePanel === t.key
                    ? 'bg-sidebar-accent text-sidebar-foreground'
                    : 'text-sidebar-muted hover:text-sidebar-foreground',
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1">
          {activePanel === 'tables' ? (
            <DatabaseTree
              connections={connections}
              selected={selected}
              onToggleTable={(name) => {
                if (!threadId) return
                setTables(
                  threadId,
                  selected.includes(name) ? selected.filter((t) => t !== name) : [...selected, name],
                )
              }}
            />
          ) : (
            <Sidebar />
          )}
        </div>
      </div>

      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>

      {user?.must_change_password && <ProfileModal forced={true} />}
    </div>
  )
}
