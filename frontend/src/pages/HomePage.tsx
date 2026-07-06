import { IconChat } from '../components/icons'

export default function HomePage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
        <IconChat className="size-6" />
      </div>
      <p className="text-sm text-muted-foreground">
        یک ورک‌اسپیس از سایدبار انتخاب کنید یا ورک‌اسپیس جدیدی بسازید.
      </p>
    </div>
  )
}
