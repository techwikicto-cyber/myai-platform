import { NavLink, Outlet } from 'react-router-dom'
import clsx from 'clsx'
import { IconSettings, IconUsers } from '../components/icons'

export default function AdminLayout() {
  const tabClass = ({ isActive }: { isActive: boolean }) =>
    clsx(
      'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
      isActive ? 'bg-primary-soft font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    )

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="border-b border-border bg-card px-6 pt-5">
        <h1 className="text-lg font-bold text-foreground">پنل مدیریت</h1>
        <div className="mt-3 flex gap-1 pb-3">
          <NavLink to="/admin/users" className={tabClass}>
            <IconUsers />
            کاربران
          </NavLink>
          <NavLink to="/admin/model-settings" className={tabClass}>
            <IconSettings />
            تنظیمات مدل‌ها
          </NavLink>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
