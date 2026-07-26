import { api } from './client'
import type { DocumentDto } from './documents'

export type DbEngine = 'postgres' | 'mysql' | 'mssql' | 'oracle' | 'mongodb'

export interface DbConnectionCreate {
  name: string
  engine: DbEngine
  host: string
  port: number
  database: string
  username?: string
  password?: string
  options?: Record<string, unknown>
}

export interface DbConnectionDto {
  id: string
  name: string
  engine: DbEngine
  host: string
  port: number
  database: string
  username: string | null
  options: Record<string, unknown>
  schema_summary: Record<string, unknown> | null
  allowed_tables: Record<string, string[] | null> | null
  available_databases: string[] | null
  selected_databases: string[] | null
  shared_workspace_ids: string[]
  last_introspected_at: string | null
  created_at: string
}

export interface TestResult {
  success: boolean
  message: string
}

export interface SharedConnectionDto {
  id: string
  name: string
  engine: DbEngine
  host: string
  database: string
  source_workspace_name: string
  schema_summary: Record<string, unknown> | null
  last_introspected_at: string | null
  created_at: string
}

export const dbConnectionsApi = {
  list: (workspaceId: string) => api.get<DbConnectionDto[]>(`/workspaces/${workspaceId}/db-connections`),
  listShared: (workspaceId: string) => api.get<SharedConnectionDto[]>(`/workspaces/${workspaceId}/db-connections/shared`),
  create: (workspaceId: string, payload: DbConnectionCreate) =>
    api.post<DbConnectionDto>(`/workspaces/${workspaceId}/db-connections`, payload),
  testNew: (workspaceId: string, payload: DbConnectionCreate) =>
    api.post<TestResult>(`/workspaces/${workspaceId}/db-connections/test`, payload),
  test: (workspaceId: string, id: string) =>
    api.post<TestResult>(`/workspaces/${workspaceId}/db-connections/${id}/test`),
  refreshSchema: (workspaceId: string, id: string) =>
    api.post<DbConnectionDto>(`/workspaces/${workspaceId}/db-connections/${id}/refresh-schema`),
  discoverDatabases: (workspaceId: string, id: string) =>
    api.post<string[]>(`/workspaces/${workspaceId}/db-connections/${id}/databases`),
  setSelectedDatabases: (workspaceId: string, id: string, selectedDatabases: string[]) =>
    api.patch<DbConnectionDto>(`/workspaces/${workspaceId}/db-connections/${id}/selected-databases`, {
      selected_databases: selectedDatabases,
    }),
  remove: (workspaceId: string, id: string) => api.delete<void>(`/workspaces/${workspaceId}/db-connections/${id}`),
  listSchemaDocs: (workspaceId: string, id: string) =>
    api.get<DocumentDto[]>(`/workspaces/${workspaceId}/db-connections/${id}/schema-docs`),
  uploadSchemaDoc: (workspaceId: string, id: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.upload<DocumentDto>(`/workspaces/${workspaceId}/db-connections/${id}/schema-docs`, formData)
  },
  setAllowlist: (workspaceId: string, id: string, allowedTables: Record<string, string[] | null> | null) =>
    api.patch<DbConnectionDto>(`/workspaces/${workspaceId}/db-connections/${id}/allowlist`, {
      allowed_tables: allowedTables,
    }),
  setShared: (workspaceId: string, id: string, workspaceIds: string[]) =>
    api.patch<DbConnectionDto>(`/workspaces/${workspaceId}/db-connections/${id}/share`, { workspace_ids: workspaceIds }),
}

export const DEFAULT_PORTS: Record<DbEngine, number> = {
  postgres: 5432,
  mysql: 3306,
  mssql: 1433,
  oracle: 1521,
  mongodb: 27017,
}

export const ENGINE_LABELS: Record<DbEngine, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mssql: 'Microsoft SQL Server',
  oracle: 'Oracle',
  mongodb: 'MongoDB',
}

export interface ConsoleResult {
  columns: string[]
  rows: Record<string, unknown>[]
  truncated: boolean
  duration_ms: number
}

/** Runs a hand-written query from the SQL console. Read-only is still enforced server-side. */
export function executeConsoleQuery(workspaceId: string, connectionId: string, sql: string, rowLimit = 200) {
  return api.post<ConsoleResult>(`/workspaces/${workspaceId}/db-connections/${connectionId}/execute`, {
    sql,
    row_limit: rowLimit,
  })
}

export interface TablePreview {
  name: string
  columns_meta: { name: string; type: string }[]
  columns: string[]
  rows: Record<string, unknown>[]
  truncated: boolean
}

export function previewTable(workspaceId: string, connectionId: string, tableName: string, limit = 100) {
  return api.get<TablePreview>(
    `/workspaces/${workspaceId}/db-connections/${connectionId}/tables/${encodeURIComponent(tableName)}/preview?limit=${limit}`,
  )
}
