import { NavLink, Outlet } from 'react-router-dom'

export default function AdminLayout() {
  const tabClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-1.5 text-sm ${isActive ? 'bg-indigo-600/20 text-indigo-300' : 'text-zinc-400 hover:bg-zinc-800'}`

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex gap-2 border-b border-zinc-800 px-8 py-3">
        <NavLink to="/admin/users" className={tabClass}>
          کاربران
        </NavLink>
        <NavLink to="/admin/model-settings" className={tabClass}>
          تنظیمات مدل‌ها
        </NavLink>
      </div>
      <Outlet />
    </div>
  )
}
