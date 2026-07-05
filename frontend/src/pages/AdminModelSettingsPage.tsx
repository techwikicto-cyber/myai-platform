import { useEffect, useState } from 'react'
import { settingsApi } from '../api/settings'
import { ApiError } from '../api/client'

export default function AdminModelSettingsPage() {
  const [llmBaseUrl, setLlmBaseUrl] = useState('')
  const [llmApiKey, setLlmApiKey] = useState('')
  const [llmModel, setLlmModel] = useState('')
  const [llmKeySet, setLlmKeySet] = useState(false)
  const [embBaseUrl, setEmbBaseUrl] = useState('')
  const [embApiType, setEmbApiType] = useState('tei')
  const [embModel, setEmbModel] = useState('')
  const [llmTestMsg, setLlmTestMsg] = useState<{ ok: boolean; msg: string } | null>(null)
  const [embTestMsg, setEmbTestMsg] = useState<{ ok: boolean; msg: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [testingLlm, setTestingLlm] = useState(false)
  const [testingEmb, setTestingEmb] = useState(false)

  useEffect(() => {
    settingsApi.get().then((s) => {
      setLlmBaseUrl(s.llm_base_url || '')
      setLlmModel(s.llm_model || '')
      setLlmKeySet(s.llm_api_key_set)
      setEmbBaseUrl(s.embedding_base_url || '')
      setEmbApiType(s.embedding_api_type)
      setEmbModel(s.embedding_model || '')
    })
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await settingsApi.update({
        llm_base_url: llmBaseUrl,
        llm_api_key: llmApiKey || undefined,
        llm_model: llmModel,
        embedding_base_url: embBaseUrl,
        embedding_api_type: embApiType,
        embedding_model: embModel,
      })
      setLlmApiKey('')
      if (llmApiKey) setLlmKeySet(true)
    } finally {
      setSaving(false)
    }
  }

  async function testLlm() {
    setTestingLlm(true)
    setLlmTestMsg(null)
    try {
      const r = await settingsApi.testLlm()
      setLlmTestMsg({ ok: r.success, msg: r.message })
    } catch (err) {
      setLlmTestMsg({ ok: false, msg: err instanceof ApiError ? err.message : 'خطا' })
    } finally {
      setTestingLlm(false)
    }
  }

  async function testEmbedding() {
    setTestingEmb(true)
    setEmbTestMsg(null)
    try {
      const r = await settingsApi.testEmbedding()
      setEmbTestMsg({ ok: r.success, msg: r.message })
    } catch (err) {
      setEmbTestMsg({ ok: false, msg: err instanceof ApiError ? err.message : 'خطا' })
    } finally {
      setTestingEmb(false)
    }
  }

  const inputClass =
    'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500'

  return (
    <div className="mx-auto w-full max-w-2xl p-8">
      <h1 className="mb-6 text-xl font-semibold text-zinc-100">تنظیمات مدل‌ها</h1>
      <form onSubmit={handleSave} className="space-y-8">
        <section className="rounded-xl bg-zinc-800/50 p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-200">مدل زبانی (LLM) — سازگار با OpenAI API</h2>
          <div className="mb-3">
            <label className="mb-1 block text-xs text-zinc-400">Base URL</label>
            <input
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className={inputClass}
            />
          </div>
          <div className="mb-3">
            <label className="mb-1 block text-xs text-zinc-400">
              API Key {llmKeySet && <span className="text-emerald-400">(تنظیم شده)</span>}
            </label>
            <input
              type="password"
              value={llmApiKey}
              onChange={(e) => setLlmApiKey(e.target.value)}
              placeholder={llmKeySet ? '••••••••' : ''}
              className={inputClass}
            />
          </div>
          <div className="mb-3">
            <label className="mb-1 block text-xs text-zinc-400">نام مدل</label>
            <input value={llmModel} onChange={(e) => setLlmModel(e.target.value)} className={inputClass} />
          </div>
          <button
            type="button"
            onClick={testLlm}
            disabled={testingLlm}
            className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-600 disabled:opacity-50"
          >
            {testingLlm ? 'در حال تست...' : 'تست اتصال'}
          </button>
          {llmTestMsg && (
            <p className={`mt-2 text-xs ${llmTestMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{llmTestMsg.msg}</p>
          )}
        </section>

        <section className="rounded-xl bg-zinc-800/50 p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-200">مدل Embedding</h2>
          <div className="mb-3">
            <label className="mb-1 block text-xs text-zinc-400">Base URL</label>
            <input
              value={embBaseUrl}
              onChange={(e) => setEmbBaseUrl(e.target.value)}
              placeholder="http://embedding:80"
              className={inputClass}
            />
          </div>
          <div className="mb-3">
            <label className="mb-1 block text-xs text-zinc-400">نوع API</label>
            <select value={embApiType} onChange={(e) => setEmbApiType(e.target.value)} className={inputClass}>
              <option value="tei">HuggingFace TEI (text-embeddings-inference)</option>
              <option value="openai">سازگار با OpenAI Embeddings API</option>
            </select>
          </div>
          <div className="mb-3">
            <label className="mb-1 block text-xs text-zinc-400">نام مدل</label>
            <input value={embModel} onChange={(e) => setEmbModel(e.target.value)} placeholder="bge-m3" className={inputClass} />
          </div>
          <button
            type="button"
            onClick={testEmbedding}
            disabled={testingEmb}
            className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-600 disabled:opacity-50"
          >
            {testingEmb ? 'در حال تست...' : 'تست اتصال'}
          </button>
          {embTestMsg && (
            <p className={`mt-2 text-xs ${embTestMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{embTestMsg.msg}</p>
          )}
        </section>

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
        </button>
      </form>
    </div>
  )
}
