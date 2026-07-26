import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import OnboardingPage from './pages/OnboardingPage'
import HomePage from './pages/HomePage'
import WorkspacePage from './pages/WorkspacePage'
import WorkspaceSettingsPage from './pages/WorkspaceSettingsPage'
import AdminLayout from './pages/AdminLayout'
import AdminUsersPage from './pages/AdminUsersPage'
import AdminModelSettingsPage from './pages/AdminModelSettingsPage'
import Layout from './components/Layout'
import KnowledgePage from './pages/KnowledgePage'
import ConsolePage from './pages/ConsolePage'
import TablePage from './pages/TablePage'
import HistoryPage from './pages/HistoryPage'
import { AdminRoute, ProtectedRoute } from './components/ProtectedRoute'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/workspace/:workspaceId" element={<WorkspacePage />} />
            <Route path="/workspace/:workspaceId/thread/:threadId" element={<WorkspacePage />} />
            <Route path="/workspace/:workspaceId/console" element={<ConsolePage />} />
            <Route path="/workspace/:workspaceId/history" element={<HistoryPage />} />
            <Route
              path="/workspace/:workspaceId/table/:connectionId/:tableName"
              element={<TablePage />}
            />
            <Route path="/workspace/:workspaceId/knowledge" element={<KnowledgePage />} />
            <Route path="/workspace/:workspaceId/settings" element={<WorkspaceSettingsPage />} />
            <Route element={<AdminRoute />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="users" replace />} />
                <Route path="users" element={<AdminUsersPage />} />
                <Route path="model-settings" element={<AdminModelSettingsPage />} />
              </Route>
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
