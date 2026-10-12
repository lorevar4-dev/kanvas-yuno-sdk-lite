const LOCALE = { BRL: 'pt-BR', MXN: 'es-MX' }

export const money = (value, currency) => new Intl.NumberFormat(LOCALE[currency] ?? 'en-US', { style: 'currency', currency }).format(value)

export const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export const METHOD_LABELS = {
  CARD: { label: 'Card', hint: 'Credit or debit', icon: '💳' },
  PIX: { label: 'PIX', hint: 'Instant QR transfer', icon: '⚡' },
  OXXO: { label: 'OXXO', hint: 'Pay cash at a store', icon: '🏪' },
}

export const TERMINAL = ['PAID', 'FAILED', 'EXPIRED']
