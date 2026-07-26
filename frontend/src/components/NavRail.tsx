import { useState } from 'react'
import { NavLink, useMatch } from 'react-router-dom'
import clsx from 'clsx'
import { useAuthStore } from '../store/auth'
import { IconBook, IconChat, IconClock, IconDatabase, IconLogout, IconSettings } from './icons'
import OwlLogo from './Logo'
import ProfileModal from './ProfileModal'

/**
 * Vertical icon rail, the outermost navigation layer in Chat2DB's shell. Sections that
 * used to be buried inside a workspace (chat, knowledge, settings) become peers here,
 * which keeps the panel beside it free to show content for whichever section is active
 * rather than always being a workspace list.
 *
 * Sits on the right because the app is RTL — the rail belongs on the side the eye
 * starts from, which is the mirror of where Chat2DB puts it.
 */
export default function NavRail() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const [showProfile, setShowProfile] = useState(false)

  const wsMatch = useMatch('/workspace/:workspaceId/*')
  const activeWorkspaceId = wsMatch?.params.workspaceId ?? null

  const items = [
    { to: '/', icon: <IconChat />, label: 'گفتگو', end: true },
    ...(activeWorkspaceId
      ? [
          {
            to: `/workspace/${activeWorkspaceId}/console`,
            icon: <IconDatabase />,
            label: 'کنسول SQL',
            end: false,
          },
          {
            to: `/workspace/${activeWorkspaceId}/history`,
            icon: <IconClock />,
            label: 'تاریخچه کوئری‌ها',
            end: false,
          },
          {
            to: `/workspace/${activeWorkspaceId}/knowledge`,
            icon: <IconBook />,
            label: 'دانش سازمانی',
            end: false,
          },
          {
            to: `/workspace/${activeWorkspaceId}/settings`,
            icon: <IconSettings />,
            label: 'تنظیمات فضای کاری',
            end: false,
          },
        ]
      : []),
    ...(user?.role === 'admin'
      ? [{ to: '/admin', icon: <IconSettings />, label: 'پنل مدیریت', end: false }]
      : []),
  ]

  return (
    <>
      <nav className="flex h-full w-14 shrink-0 flex-col items-center border-l border-sidebar-border bg-sidebar py-3">
        <OwlLogo className="mb-3 size-8 shrink-0" />
        <div className="mx-2 mb-2 h-px w-8 bg-sidebar-border" />

        <div className="flex flex-1 flex-col items-center gap-1">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) =>
                clsx(
                  'flex size-9 items-center justify-center rounded-lg transition-colors',
                  isActive
                    ? 'bg-sidebar-primary-bg text-sidebar-primary'
                    : 'text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                )
              }
            >
              {item.icon}
            </NavLink>
          ))}
        </div>

        <button
          onClick={() => setShowProfile(true)}
          title={user?.full_name || user?.email || 'پروفایل'}
          className="mb-1 flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent/60"
        >
          {user?.profile_picture ? (
            <img src={user.profile_picture} alt="" className="size-7 rounded-full border border-white/10 object-cover" />
          ) : (
            <span className="flex size-7 items-center justify-center rounded-full border border-primary/20 bg-primary/20 text-[11px] font-bold uppercase text-primary">
              {user?.email?.[0] || 'U'}
            </span>
          )}
        </button>
        <button
          onClick={logout}
          title="خروج"
          className="flex size-9 items-center justify-center rounded-lg text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-destructive"
        >
          <IconLogout />
        </button>
      </nav>

      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
    </>
  )
}
