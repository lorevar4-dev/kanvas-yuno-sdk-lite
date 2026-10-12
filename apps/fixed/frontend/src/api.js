async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.detail ?? json.error ?? `Request failed (${res.status})`)
  return json
}

export const api = {
  config: () => request('GET', '/config'),
  createOrder: (payload) => request('POST', '/orders', payload),
  pay: (orderId, payload) => request('POST', `/orders/${orderId}/payments`, payload),
  getOrder: (orderId) => request('GET', `/orders/${orderId}`),
}
