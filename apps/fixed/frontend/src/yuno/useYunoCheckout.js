// initialize → startCheckout → mountCheckoutLite → startPayment → createPayment → continuePayment
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { loadYuno } from './loadSdk.js'

export function useYunoCheckout({ config, checkout, demoDoubleClick, onPaymentCreated, onPayAttempts }) {
  const [ready, setReady] = useState(false)
  const [method, setMethod] = useState(null)
  const [mounted, setMounted] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const yunoRef = useRef(null)
  const busyRef = useRef(false)
  const tokenStartedRef = useRef(false)
  // SDK keeps the first callbacks it gets, so read current values from a ref
  const latest = useRef({})
  latest.current = { checkout, demoDoubleClick, onPaymentCreated, onPayAttempts, method }

  const setBusyBoth = (value) => {
    busyRef.current = value
    setBusy(value)
  }

  const handleOneTimeToken = useCallback(async (oneTimeToken, tokenWithInformation) => {
    const { checkout, demoDoubleClick, onPaymentCreated, onPayAttempts } = latest.current
    const payload = { oneTimeToken, vaultOnSuccess: !!tokenWithInformation?.vault_on_success }
    const calls = demoDoubleClick ? [api.pay(checkout.order.id, payload), api.pay(checkout.order.id, payload)] : [api.pay(checkout.order.id, payload)]
    const results = await Promise.allSettled(calls)
    onPayAttempts?.(results)

    const created = results.find((r) => r.status === 'fulfilled')?.value
    if (!created) {
      setError(results[0].reason?.message ?? 'Payment failed')
      setBusyBoth(false)
      return
    }
    if (created.sdkActionRequired) await yunoRef.current.continuePayment({ showPaymentStatus: true })
    onPaymentCreated?.(created.order)
  }, [])

  // Card needs its form up front. PIX/OXXO have no form and the SDK tokenizes them as soon as they
  // are mounted, so they are only mounted when the shopper presses Pay (see pay()).
  const mount = useCallback(async (paymentMethodType) => {
    if (!yunoRef.current) return
    setError(null)
    setMethod(paymentMethodType)
    if (paymentMethodType !== 'CARD') return
    await yunoRef.current.mountCheckoutLite({ paymentMethodType })
    setMounted(paymentMethodType)
  }, [])

  useEffect(() => {
    if (!checkout?.checkoutSession) return
    let cancelled = false
    setReady(false)
    setMounted(null)
    setBusyBoth(false)
    setError(null)
    ;(async () => {
      const yuno = await loadYuno(config)
      if (cancelled) return
      yunoRef.current = yuno
      await yuno.startCheckout({
        checkoutSession: checkout.checkoutSession,
        elementSelector: '#yuno-root',
        countryCode: checkout.countryCode,
        language: checkout.language,
        showLoading: true,
        showPayButton: false,
        showPaymentStatus: true,
        renderMode: { type: 'element', elementSelector: { apmForm: '#yuno-form', actionForm: '#yuno-action' } },
        card: { cardSaveEnable: true },
        // fires only once the form passed validation
        onOneTimeTokenCreationStart: () => (tokenStartedRef.current = true),
        createPayment: handleOneTimeToken,
        paymentResult: (status, subStatus) => console.info('[checkout] SDK payment result (display only):', status, subStatus ?? ''),
        error: (message, data) => {
          console.error('[checkout] SDK error', message, data)
          setError(String(message))
          setBusyBoth(false)
        },
      })
      if (cancelled) return
      setReady(true)
      await mount(checkout.methods[0])
    })().catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [checkout?.checkoutSession, config, handleOneTimeToken, mount])

  const pay = useCallback(async () => {
    const { demoDoubleClick, method } = latest.current
    if (!yunoRef.current || (busyRef.current && !demoDoubleClick)) return
    setBusyBoth(true)
    setError(null)
    tokenStartedRef.current = false
    const submit = async () => {
      // The Lite card form only listens to submitOneTimeTokenForm()
      if (method === 'CARD') return yunoRef.current.submitOneTimeTokenForm()
      // No form to validate: mounting PIX/OXXO makes the SDK create the one-time token
      tokenStartedRef.current = true
      await yunoRef.current.mountCheckoutLite({ paymentMethodType: method })
      setMounted(method)
    }
    try {
      if (demoDoubleClick && method === 'CARD') await Promise.all([submit(), submit()])
      else await submit()
      // Returns right away; an invalid card form shows its own errors and never calls back
      setTimeout(() => !tokenStartedRef.current && setBusyBoth(false), 1500)
    } catch (err) {
      setError(err.message)
      setBusyBoth(false)
    }
  }, [])

  return { ready, method, mounted, busy, error, mount, pay }
}
