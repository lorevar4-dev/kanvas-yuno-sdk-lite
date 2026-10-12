let instancePromise

export function loadYuno({ mode, publicKey }) {
  instancePromise ??= (async () => {
    const { loadScript } = mode === 'mock' ? await import('@kanvas/mock-yuno-sdk') : await import('@yuno-payments/sdk-web')
    // defaults to production without env
    const sdk = await loadScript({ env: 'sandbox' })
    return sdk.initialize(publicKey)
  })()
  return instancePromise
}
