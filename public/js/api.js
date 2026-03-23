window.api = {
  async _fetch(method, url, data) {
    const isFormData = data instanceof FormData
    const opts = {
      method,
      headers: isFormData ? {} : { 'Content-Type': 'application/json' },
      body: data ? (isFormData ? data : JSON.stringify(data)) : undefined,
    }
    const res = await fetch(url, opts)
    if (res.status === 401) { window.location.href = '/login.html'; return }
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
    return json
  },

  get(url, params) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return this._fetch('GET', url + qs)
  },

  post(url, data)   { return this._fetch('POST', url, data) },
  put(url, data)    { return this._fetch('PUT', url, data) },
  delete(url, data) { return this._fetch('DELETE', url, data) },
}
