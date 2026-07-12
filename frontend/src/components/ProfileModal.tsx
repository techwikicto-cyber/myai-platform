import { useState, useRef } from 'react'
import { useAuthStore } from '../store/auth'
import { usersApi } from '../api/users'
import { IconX, IconUpload } from './icons'

interface ProfileModalProps {
  forced?: boolean
  onClose?: () => void
}

export default function ProfileModal({ forced = false, onClose }: ProfileModalProps) {
  const { user, setSession, token } = useAuthStore()
  const [activeTab, setActiveTab] = useState<'profile' | 'password'>(forced ? 'password' : 'profile')
  
  // Profile State
  const [fullName, setFullName] = useState(user?.full_name || '')
  const [avatar, setAvatar] = useState(user?.profile_picture || '')
  const [profileSaving, setProfileSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Password State
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    // Create a canvas to resize image
    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const MAX_SIZE = 200
        let width = img.width
        let height = img.height

        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width
            width = MAX_SIZE
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height
            height = MAX_SIZE
          }
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(img, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/webp', 0.8)
        
        // Simple size check (roughly)
        if (dataUrl.length > 50000 * 1.37) {
          alert('حجم عکس خیلی زیاد است!')
          return
        }
        setAvatar(dataUrl)
      }
      img.src = event.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  async function saveProfile() {
    setProfileSaving(true)
    try {
      const updatedUser = await usersApi.updateProfile({ full_name: fullName, profile_picture: avatar })
      if (token) setSession(token, updatedUser)
      if (!forced && onClose) onClose()
    } catch (e: any) {
      alert('خطا در ذخیره پروفایل')
    } finally {
      setProfileSaving(false)
    }
  }

  async function savePassword() {
    if (newPassword !== confirmPassword) {
      setPasswordError('رمزهای عبور جدید با هم مطابقت ندارند')
      return
    }
    if (newPassword.length < 6) {
      setPasswordError('رمز عبور باید حداقل ۶ کاراکتر باشد')
      return
    }
    setPasswordSaving(true)
    setPasswordError('')
    try {
      const updatedUser = await usersApi.changePassword({ current_password: currentPassword, new_password: newPassword })
      if (token) setSession(token, updatedUser)
      if (forced && onClose) onClose()
      else if (onClose) onClose()
    } catch (e: any) {
      setPasswordError('رمز عبور فعلی نادرست است یا خطایی رخ داده')
    } finally {
      setPasswordSaving(false)
    }
  }

  function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    savePassword()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4 bg-muted/30">
          <h2 className="text-lg font-bold text-foreground">
            {forced ? 'تغییر رمز عبور اجباری' : 'تنظیمات حساب کاربری'}
          </h2>
          {!forced && (
            <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
              <IconX />
            </button>
          )}
        </div>

        {/* Tabs */}
        {!forced && (
          <div className="flex border-b border-border">
            <button
              onClick={() => setActiveTab('profile')}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === 'profile' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }`}
            >
              پروفایل
            </button>
            <button
              onClick={() => setActiveTab('password')}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === 'password' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }`}
            >
              تغییر رمز عبور
            </button>
          </div>
        )}

        {/* Content */}
        <div className="p-5 overflow-y-auto">
          {activeTab === 'profile' && !forced && (
            <div className="space-y-6">
              <div className="flex flex-col items-center gap-3">
                <div 
                  className="relative size-24 rounded-full border-2 border-border bg-muted overflow-hidden cursor-pointer group flex items-center justify-center"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {avatar ? (
                    <img src={avatar} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl text-muted-foreground font-bold">{user?.email[0].toUpperCase()}</span>
                  )}
                  <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <IconUpload className="text-white mb-1" />
                    <span className="text-[10px] text-white">آپلود</span>
                  </div>
                </div>
                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleAvatarChange} />
                <p className="text-xs text-muted-foreground text-center">حجم مجاز: ۵۰ کیلوبایت (خودکار فشرده می‌شود)</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">نام و نام خانوادگی</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    placeholder="مثال: علی رضایی"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">ایمیل (غیرقابل تغییر)</label>
                  <input
                    type="text"
                    value={user?.email || ''}
                    disabled
                    className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground outline-none opacity-70"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={saveProfile}
                  disabled={profileSaving}
                  className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {profileSaving ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'password' && (
            <form onSubmit={onPasswordSubmit} className="space-y-4">
              {/* Hidden username field for accessibility / autocomplete rules */}
              <input type="text" autoComplete="username" value={user?.email || ''} readOnly className="hidden" />
              
              {forced && (
                <div className="mb-4 rounded-lg bg-blue-500/10 p-3 border border-blue-500/20 text-sm text-blue-400 leading-relaxed">
                  از آنجا که این حساب کاربری توسط مدیر سیستم برای شما ساخته شده است، برای حفظ امنیت، ابتدا باید رمز عبور خود را تغییر دهید.
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">رمز عبور فعلی</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  dir="ltr"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">رمز عبور جدید</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">تکرار رمز عبور جدید</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  dir="ltr"
                />
              </div>

              {passwordError && (
                <div className="text-sm text-destructive">{passwordError}</div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={passwordSaving}
                  className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {passwordSaving ? 'در حال ذخیره...' : (forced ? 'تغییر رمز و ورود' : 'تغییر رمز عبور')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
