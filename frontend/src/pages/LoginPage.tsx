import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/auth'
import { useAuthStore } from '../store/auth'
import { ApiError } from '../api/client'
import AuthLayout from '../components/AuthLayout'
import { Alert, Button, Field, Input, Spinner } from '../components/ui'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const setSession = useAuthStore((s) => s.setSession)
  const navigate = useNavigate()

  useEffect(() => {
    authApi.status().then((s) => {
      if (s.needs_onboarding) navigate('/onboarding', { replace: true })
    })
  }, [navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await authApi.login(email, password)
      setSession(res.access_token, res.user)
      navigate('/')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطای غیرمنتظره')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="پلتفرم بینا" subtitle="برای ادامه وارد حساب خود شوید">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="ایمیل">
          <Input
            type="email"
            required
            autoComplete="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="رمز عبور">
          <Input
            type="password"
            required
            autoComplete="current-password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <Alert kind="error">{error}</Alert>}
        <Button type="submit" disabled={loading} className="w-full">
          {loading && <Spinner />}
          ورود
        </Button>
      </form>
    </AuthLayout>
  )
}
