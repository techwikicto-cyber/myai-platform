import { api } from './client'

/** Mirrors the backend KnowledgeKind — the three kinds of curated domain knowledge. */
export type KnowledgeKind = 'term' | 'business_logic' | 'sql_template'

export interface KnowledgeEntryDto {
  id: string
  workspace_id: string
  db_connection_id: string | null
  kind: KnowledgeKind
  name: string
  content: string
  created_at: string
  updated_at: string
}

export interface KnowledgeEntryCreate {
  kind: KnowledgeKind
  name: string
  content: string
  db_connection_id?: string | null
}

export const knowledgeApi = {
  list: (workspaceId: string, kind?: KnowledgeKind) =>
    api.get<KnowledgeEntryDto[]>(
      `/workspaces/${workspaceId}/knowledge${kind ? `?kind=${kind}` : ''}`,
    ),
  create: (workspaceId: string, payload: KnowledgeEntryCreate) =>
    api.post<KnowledgeEntryDto>(`/workspaces/${workspaceId}/knowledge`, payload),
  update: (workspaceId: string, id: string, payload: Partial<KnowledgeEntryCreate>) =>
    api.patch<KnowledgeEntryDto>(`/workspaces/${workspaceId}/knowledge/${id}`, payload),
  remove: (workspaceId: string, id: string) =>
    api.delete<void>(`/workspaces/${workspaceId}/knowledge/${id}`),
}

export const KNOWLEDGE_KINDS: {
  value: KnowledgeKind
  label: string
  description: string
  namePlaceholder: string
  contentPlaceholder: string
}[] = [
  {
    value: 'term',
    label: 'اصطلاحات',
    description:
      'معنی واژه‌های سازمانی و اینکه هرکدام به کدام جدول یا ستون نگاشت می‌شوند. مهم‌ترین بخش برای دیتابیس‌هایی که نام جدول‌هایشان گویا نیست.',
    namePlaceholder: 'مثلاً: حساب کل',
    contentPlaceholder:
      'مثلاً: در جدول _Accs، رکوردهایی که acc_Level برابر ۱ دارند. کد حساب در acc_Code و نام آن در acc_Name است.',
  },
  {
    value: 'business_logic',
    label: 'قواعد کسب‌وکار',
    description: 'محاسبات و قواعدی که از روی ساختار جدول‌ها قابل حدس زدن نیستند.',
    namePlaceholder: 'مثلاً: محاسبه مانده حساب',
    contentPlaceholder:
      'مثلاً: مانده هر حساب برابر است با مجموع tr_Deb منهای مجموع tr_Cre در جدول _Transes.',
  },
  {
    value: 'sql_template',
    label: 'نمونه کوئری‌ها',
    description:
      'کوئری‌های درست و تأییدشده برای پرسش‌های پرتکرار. مدل به‌جای ساختن JOIN از صفر، نمونه‌ی درست را تطبیق می‌دهد.',
    namePlaceholder: 'مثلاً: لیست حساب‌های کل با مانده',
    contentPlaceholder: 'SELECT a.acc_Code, a.acc_Name, SUM(t.tr_Deb - t.tr_Cre) AS balance\nFROM ...',
  },
]
