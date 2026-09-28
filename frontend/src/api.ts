export type Provider = 'deepseek' | 'anthropic' | 'openai'
export type Section = 'chat' | 'discover' | 'favorites' | 'knowledge'

export interface User {
  id: number
  email: string
  display_name: string
  created_at: string
}

export interface Evidence {
  title: string
  url: string
  snippet: string
  source_name: string
  kind: 'shopping' | 'specs' | 'reviews'
  observed_at: string
  price_text: string | null
  rating_text: string | null
  is_purchase_link: boolean
}

export interface Favorite {
  id: number
  title: string
  source_url: string
  source_name: string
  price_text: string | null
  note: string | null
  saved_at: string
}

export interface KnowledgeDoc {
  id: number
  filename: string
  chunk_count: number
  created_at: string
}

export interface Conversation {
  id: number
  title: string
  created_at: string
}

export interface ChatMessage {
  id?: number
  role: 'user' | 'assistant'
  content: string
  created_at?: string
  sources?: Evidence[]
}

export interface AppStatus {
  providers: Record<Provider, boolean>
  live_search: boolean
}

const BASE = import.meta.env.VITE_API_BASE || ''

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('digital_compass_token')
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${BASE}/api${path}`, { ...options, headers })
  if (!response.ok) {
    let detail = `请求失败 (${response.status})`
    try {
      const body = await response.json()
      if (typeof body.detail === 'string') detail = body.detail
    } catch { /* non-JSON server error */ }
    throw new Error(detail)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const postJson = <T>(path: string, data: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(data) })

export const formatTime = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
