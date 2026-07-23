import { useEffect, useState } from 'react'
import { settingsApi, type ModelSettingsIn } from '../api/settings'
import { ApiError } from '../api/client'
import { Alert, Button, Card, CardHeader, Field, Input, Select, Spinner } from '../components/ui'

export default function AdminModelSettingsPage() {
  const [llmBaseUrl, setLlmBaseUrl] = useState('')
  const [llmApiKey, setLlmApiKey] = useState('')
  const [llmModel, setLlmModel] = useState('')
  const [llmKeySet, setLlmKeySet] = useState(false)
  const [reviewerBaseUrl, setReviewerBaseUrl] = useState('')
  const [reviewerApiKey, setReviewerApiKey] = useState('')
  const [reviewerModel, setReviewerModel] = useState('')
  const [reviewerKeySet, setReviewerKeySet] = useState(false)
  const [embBaseUrl, setEmbBaseUrl] = useState('')
  const [embApiType, setEmbApiType] = useState('tei')
  const [embModel, setEmbModel] = useState('')
  const [llmTestMsg, setLlmTestMsg] = useState<{ ok: boolean; msg: string } | null>(null)
  const [reviewerTestMsg, setReviewerTestMsg] = useState<{ ok: boolean; msg: string } | null>(null)
  const [embTestMsg, setEmbTestMsg] = useState<{ ok: boolean; msg: string } | null>(null)
  const [savedMsg, setSavedMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [testingLlm, setTestingLlm] = useState(false)
  const [testingReviewer, setTestingReviewer] = useState(false)
  const [testingEmb, setTestingEmb] = useState(false)

  useEffect(() => {
    settingsApi.get().then((s) => {
      setLlmBaseUrl(s.llm_base_url || '')
      setLlmModel(s.llm_model || '')
      setLlmKeySet(s.llm_api_key_set)
      setReviewerBaseUrl(s.reviewer_llm_base_url || '')
      setReviewerModel(s.reviewer_llm_model || '')
      setReviewerKeySet(s.reviewer_llm_api_key_set)
      setEmbBaseUrl(s.embedding_base_url || '')
      setEmbApiType(s.embedding_api_type)
      setEmbModel(s.embedding_model || '')
    })
  }, [])

  function formPayload(): ModelSettingsIn {
    return {
      llm_base_url: llmBaseUrl,
      llm_api_key: llmApiKey || undefined,
      llm_model: llmModel,
      embedding_base_url: embBaseUrl,
      embedding_api_type: embApiType,
      embedding_model: embModel,
      reviewer_llm_base_url: reviewerBaseUrl,
      reviewer_llm_api_key: reviewerApiKey || undefined,
      reviewer_llm_model: reviewerModel,
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSavedMsg('')
    try {
      await settingsApi.update(formPayload())
      setLlmApiKey('')
      if (llmApiKey) setLlmKeySet(true)
      setReviewerApiKey('')
      if (reviewerApiKey) setReviewerKeySet(true)
      setSavedMsg('تنظیمات ذخیره شد')
      setTimeout(() => setSavedMsg(''), 3000)
    } finally {
      setSaving(false)
    }
  }

  // Tests run against the *current form values*, so no save-first is needed.
  async function testLlm() {
    setTestingLlm(true)
    setLlmTestMsg(null)
    try {
      const r = await settingsApi.testLlm(formPayload())
      setLlmTestMsg({ ok: r.success, msg: r.message })
    } catch (err) {
      setLlmTestMsg({ ok: false, msg: err instanceof ApiError ? err.message : 'خطا' })
    } finally {
      setTestingLlm(false)
    }
  }

  async function testReviewer() {
    setTestingReviewer(true)
    setReviewerTestMsg(null)
    try {
      const r = await settingsApi.testReviewerLlm(formPayload())
      setReviewerTestMsg({ ok: r.success, msg: r.message })
    } catch (err) {
      setReviewerTestMsg({ ok: false, msg: err instanceof ApiError ? err.message : 'خطا' })
    } finally {
      setTestingReviewer(false)
    }
  }

  async function testEmbedding() {
    setTestingEmb(true)
    setEmbTestMsg(null)
    try {
      const r = await settingsApi.testEmbedding(formPayload())
      setEmbTestMsg({ ok: r.success, msg: r.message })
    } catch (err) {
      setEmbTestMsg({ ok: false, msg: err instanceof ApiError ? err.message : 'خطا' })
    } finally {
      setTestingEmb(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <CardHeader
            title="مدل زبانی (LLM)"
            description="هر سرویس سازگار با OpenAI Chat Completions API — مثل Ollama، vLLM یا OpenAI"
          />
          <div className="space-y-4 p-6">
            <Field label="Base URL" hint="مثال: http://ollama:11434/v1 یا https://api.openai.com/v1">
              <Input dir="ltr" value={llmBaseUrl} onChange={(e) => setLlmBaseUrl(e.target.value)} placeholder="https://…/v1" />
            </Field>
            <Field label={llmKeySet ? 'API Key (ذخیره شده — برای تغییر مقدار جدید وارد کنید)' : 'API Key'}>
              <Input
                dir="ltr"
                type="password"
                value={llmApiKey}
                onChange={(e) => setLlmApiKey(e.target.value)}
                placeholder={llmKeySet ? '••••••••••••' : 'اگر سرویس نیاز ندارد خالی بگذارید'}
              />
            </Field>
            <Field label="نام مدل">
              <Input dir="ltr" value={llmModel} onChange={(e) => setLlmModel(e.target.value)} placeholder="gemma2:9b" />
            </Field>
            <div className="flex items-center gap-3 pt-1">
              <Button type="button" variant="secondary" size="sm" onClick={testLlm} disabled={testingLlm || !llmBaseUrl}>
                {testingLlm && <Spinner />}
                تست اتصال
              </Button>
              {llmTestMsg && <Alert kind={llmTestMsg.ok ? 'success' : 'error'}>{llmTestMsg.msg}</Alert>}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="مدل بازبین (اختیاری)"
            description="قبل از اجرای هر کوئری دیتابیس، این مدل جدا بررسی می‌کند که آیا کوئری واقعاً به سؤال کاربر جواب می‌دهد — فقط پرچم می‌زند، هرگز خودش کوئری را اجرا یا بازنویسی نمی‌کند. خالی‌گذاشتن Base URL یعنی غیرفعال."
          />
          <div className="space-y-4 p-6">
            <Field label="Base URL" hint="مثال: http://ollama:11434/v1">
              <Input dir="ltr" value={reviewerBaseUrl} onChange={(e) => setReviewerBaseUrl(e.target.value)} placeholder="https://…/v1" />
            </Field>
            <Field label={reviewerKeySet ? 'API Key (ذخیره شده — برای تغییر مقدار جدید وارد کنید)' : 'API Key'}>
              <Input
                dir="ltr"
                type="password"
                value={reviewerApiKey}
                onChange={(e) => setReviewerApiKey(e.target.value)}
                placeholder={reviewerKeySet ? '••••••••••••' : 'اگر سرویس نیاز ندارد خالی بگذارید'}
              />
            </Field>
            <Field label="نام مدل">
              <Input dir="ltr" value={reviewerModel} onChange={(e) => setReviewerModel(e.target.value)} placeholder="gemma4:26b" />
            </Field>
            <div className="flex items-center gap-3 pt-1">
              <Button type="button" variant="secondary" size="sm" onClick={testReviewer} disabled={testingReviewer || !reviewerBaseUrl}>
                {testingReviewer && <Spinner />}
                تست اتصال
              </Button>
              {reviewerTestMsg && <Alert kind={reviewerTestMsg.ok ? 'success' : 'error'}>{reviewerTestMsg.msg}</Alert>}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="مدل Embedding"
            description="برای جستجوی معنایی روی اسناد — سرویس پیش‌فرض bge-m3 داخل docker-compose موجود است"
          />
          <div className="space-y-4 p-6">
            <Field label="Base URL" hint="پیش‌فرض: http://embedding:80 (سرویس داخلی TEI)">
              <Input dir="ltr" value={embBaseUrl} onChange={(e) => setEmbBaseUrl(e.target.value)} placeholder="http://embedding:80" />
            </Field>
            <Field label="نوع API">
              <Select value={embApiType} onChange={(e) => setEmbApiType(e.target.value)}>
                <option value="tei">HuggingFace TEI (text-embeddings-inference)</option>
                <option value="openai">سازگار با OpenAI Embeddings API</option>
              </Select>
            </Field>
            <Field label="نام مدل">
              <Input dir="ltr" value={embModel} onChange={(e) => setEmbModel(e.target.value)} placeholder="bge-m3" />
            </Field>
            <div className="flex items-center gap-3 pt-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={testEmbedding}
                disabled={testingEmb || !embBaseUrl}
              >
                {testingEmb && <Spinner />}
                تست اتصال
              </Button>
              {embTestMsg && <Alert kind={embTestMsg.ok ? 'success' : 'error'}>{embTestMsg.msg}</Alert>}
            </div>
          </div>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving && <Spinner />}
            ذخیره تنظیمات
          </Button>
          {savedMsg && <Alert kind="success">{savedMsg}</Alert>}
        </div>
      </form>
    </div>
  )
}
