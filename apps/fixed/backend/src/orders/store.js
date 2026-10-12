// JSON file store for the demo; production would use the real DB.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { config } from '../config.js'

// One file per mode: Yuno ids from the simulator don't exist in the sandbox (CUSTOMER_NOT_FOUND)
const dir = new URL('../../data/', import.meta.url)
const file = new URL(`store.${config.mode}.json`, dir)

const state = { orders: {}, customers: {} }
if (existsSync(file)) Object.assign(state, JSON.parse(readFileSync(file, 'utf8')))

function persist() {
  mkdirSync(dir, { recursive: true })
  const tmp = new URL(`store.${config.mode}.json.tmp`, dir)
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, file)
}

export const store = {
  getOrder: (id) => state.orders[id] ?? null,
  saveOrder(order) {
    order.updatedAt = new Date().toISOString()
    state.orders[order.id] = order
    persist()
    return order
  },
  findOrderByPaymentId: (paymentId) => Object.values(state.orders).find((o) => o.yuno.paymentId === paymentId) ?? null,
  pendingOrders: () => Object.values(state.orders).filter((o) => o.status === 'PENDING' && o.yuno.paymentId),
  getCustomerId: (key) => state.customers[key] ?? null,
  saveCustomerId(key, id) {
    state.customers[key] = id
    persist()
  },
}
