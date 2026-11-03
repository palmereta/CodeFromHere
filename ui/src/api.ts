import type { HostKeyInfo } from './types'

export class ApiError extends Error {
  status: number
  data: any
  constructor(status: number, data: any) {
    super(data?.error || `HTTP ${status}`)
    this.status = status
    this.data = data
  }
  get hostKey(): HostKeyInfo | null { return this.data?.hostKey ?? null }
  get code(): string | undefined { return this.data?.code }
}

let onUnauthorized: (() => void) | null = null
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

async function request<T = any>(method: string, url: string, body?: any): Promise<T> {
  const headers: Record<string, string> = { 'x-cfh-csrf': '1' }
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body) }
  const res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/login') && !data?.mfa_required) onUnauthorized?.()
    throw new ApiError(res.status, data)
  }
  return data as T
}

const qs = (o: Record<string, any>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString()

export const api = {
  get: <T = any>(url: string, params?: Record<string, any>) => request<T>('GET', params ? `${url}?${qs(params)}` : url),
  post: <T = any>(url: string, body?: any) => request<T>('POST', url, body ?? {}),
  put: <T = any>(url: string, body?: any) => request<T>('PUT', url, body ?? {}),
  patch: <T = any>(url: string, body?: any) => request<T>('PATCH', url, body ?? {}),
  del: <T = any>(url: string) => request<T>('DELETE', url),
  qs,
}

export const wsUrl = (path: string) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`

export function formatBytes(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return ''
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v < 10 && i ? v.toFixed(1) : Math.round(v)} ${u[i]}`
}

export function formatDate(ms: number | null | undefined) {
  if (!ms) return ''
  const d = new Date(ms)
  const now = new Date()
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })
}

export function timeAgo(ms: number | null | undefined) {
  if (!ms) return ''
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}
