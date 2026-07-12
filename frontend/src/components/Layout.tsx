import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import ProfileModal from './ProfileModal'
import { useAuthStore } from '../store/auth'

export default function Layout() {
  const { user } = useAuthStore()
  
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
      
      {user?.must_change_password && <ProfileModal forced={true} />}
    </div>
  )
}
