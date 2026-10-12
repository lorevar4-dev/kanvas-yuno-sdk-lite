// Per-order mutex (single process). Across processes, the idempotency key covers it.
const tails = new Map()

export async function withOrderLock(orderId, fn) {
  const previous = tails.get(orderId) ?? Promise.resolve()
  let release
  const current = new Promise((resolve) => (release = resolve))
  const tail = previous.then(() => current)
  tails.set(orderId, tail)
  await previous
  try {
    return await fn()
  } finally {
    release()
    if (tails.get(orderId) === tail) tails.delete(orderId)
  }
}
