export const MARKETS = {
  BR: { label: 'Brazil', currency: 'BRL', language: 'pt', methods: ['CARD', 'PIX'] },
  MX: { label: 'Mexico', currency: 'MXN', language: 'es', methods: ['CARD', 'OXXO'] },
}

export const PRODUCTS = {
  'linen-throw': { name: 'Linen throw blanket', price: { BRL: 189.9, MXN: 649 } },
  'ceramic-vase': { name: 'Ceramic vase', price: { BRL: 79.9, MXN: 279 } },
  'oak-tray': { name: 'Oak serving tray', price: { BRL: 129.9, MXN: 449 } },
}

const round2 = (n) => Math.round(n * 100) / 100

export function priceCart(country, items) {
  const market = MARKETS[country]
  if (!market) throw new Error(`Unsupported country "${country}"`)
  if (!Array.isArray(items) || items.length === 0) throw new Error('Cart is empty')

  const lines = items.map(({ sku, quantity }) => {
    const product = PRODUCTS[sku]
    if (!product) throw new Error(`Unknown SKU "${sku}"`)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw new Error(`Invalid quantity for ${sku}`)
    const unit = product.price[market.currency]
    return { sku, name: product.name, quantity, unitAmount: unit, amount: round2(unit * quantity) }
  })

  return { currency: market.currency, lines, total: round2(lines.reduce((sum, l) => sum + l.amount, 0)) }
}
