import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { workspacesApi } from '../api/workspaces'
import { dbConnectionsApi, type DbConnectionDto } from '../api/dbConnections'
import KnowledgePanel from '../components/KnowledgePanel'
import { IconChevronDown } from '../components/icons'
import type { Workspace } from '../types'

/**
 * Knowledge gets its own page rather than a settings tab, mirroring how Chat2DB treats
 * knowledge management as a first-class destination: it's content people add to and
 * revise as they learn the database, not one-time configuration.
 */
export default function KnowledgePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [connections, setConnections] = useState<DbConnectionDto[]>([])

  useEffect(() => {
    if (!workspaceId) return
    workspacesApi.get(workspaceId).then(setWorkspace).catch(() => {})
    dbConnectionsApi.list(workspaceId).then(setConnections).catch(() => {})
  }, [workspaceId])

  if (!workspaceId) return null

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-6">
        <div className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Link to={`/workspace/${workspaceId}`} className="hover:text-foreground">
            {workspace?.name || 'فضای کاری'}
          </Link>
          <IconChevronDown className="size-3 -rotate-90" />
          <span className="text-foreground">دانش سازمانی</span>
        </div>
        <KnowledgePanel workspaceId={workspaceId} connections={connections} />
      </div>
    </div>
  )
}
