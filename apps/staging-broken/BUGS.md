# Staging code — annotated

Diego's code from the brief, used to show the problems live next to the fix. Do not ship it.

`frontend/src/checkout.jsx` and `backend/routes/payments.js` are **byte-for-byte the code in the brief**
(`diff` against the brief returns nothing). Everything else in this folder only exists so they can run.

## What was added to make it run

None of this fixes anything.

**1. The Vite proxy** (`frontend/vite.config.js` + `frontend/src/shim/rewriteYunoUrl.js`)

Diego's code calls `https://api-sandbox.y.uno` straight from the browser. The browser blocks that
(CORS), so the demo would stop at a CORS error and never reach the real bugs. The shim rewrites the
URL to `/yuno-api/...` on the same origin, and Vite forwards it to Yuno **with the same headers**.

```
browser ── private-secret-key ──► Vite :5173 /yuno-api ── same request ──► api-sandbox.y.uno
   └── visible in DevTools → Network
```

The leak stays exactly as it was: the secret key still leaves the browser.

**2. Key injection** (`frontend/vite.config.js`, `injectKeys`)

The brief has placeholder keys (`'sandbox_pub_9f2c...'`, `'sandbox_secret_a17d...'`). Vite replaces those
two strings when it serves `checkout.jsx`; the file on disk keeps the placeholders.

**3. Mock SDK alias** (`frontend/vite.config.js`, mock mode only)

`@yuno-payments/sdk-web` resolves to `tools/mock-yuno/sdk`, which has the same API.

**4. Test page** (`frontend/src/App.jsx`, `main.jsx`, `index.html`)

Two buttons that call `initCheckout(cart)` and `onPayClick(token)` and print whatever they throw.

**5. Backend boot** (`backend/server.js`)

Creates the Express `app` that `payments.js` uses as a global. In mock mode it points the hardcoded
Yuno URL at the simulator.

## Bugs, by severity

### Security — fix before anything else

1. **Secret key in the browser** (`checkout.jsx:4`). It ships in the JS bundle and is sent as a header
   on two requests. Anyone can read it and create, refund, or query payments as Kanvas.
   **The key must be rotated now**, whatever else ships Monday. *This is what the security lead saw.*
2. **The checkout session and the payment are created from the browser** (`checkout.jsx:9`, `:42`). Both are server-to-server calls.
3. **The SDK gets the secret key**: `loadScript(YUNO_SECRET_KEY)` (`checkout.jsx:25`).

### Why "it kinda works" / "SDK not ready"

4. **`loadScript()` takes options, not a key.** Its signature is `loadScript({ env })`. The string is ignored, so
   `env` defaults to **production** — the production SDK loads against a sandbox session.
5. **`initialize(publicKey)` is never called.** `loadScript()` resolves to the SDK namespace, not an instance, so
   `yuno.startPayment` doesn't exist → `TypeError: yuno.startPayment is not a function`.
6. **Wrong call order** (`checkout.jsx:27`). `startPayment()` runs before `startCheckout()` / `mountCheckoutLite()`. The correct order is
   `initialize → startCheckout → mountCheckoutLite → startPayment → createPayment callback → continuePayment`.
7. **The session request is missing required fields** (`account_id`, `merchant_order_id`, `payment_description`) → HTTP 400,
   so `checkoutSession` is `undefined`.

> Note: run as shared, this code fails every time, not "~50%". Whatever Diego tested on staging was
> probably a slightly different version. The bugs above are what this exact code does.

### Why PIX and OXXO never show up

8. **`countryCode: 'US'` is hardcoded** (`checkout.jsx:32`). Methods are enabled per country, and the US market only has cards. It must come from the cart (`BR` / `MX`).
9. **Only `CARD` is ever mounted** (`checkout.jsx:37`). Each enabled method needs its own `mountCheckoutLite({ paymentMethodType })`.

### Why PIX stays "pending forever"

10. **No `createPayment` callback is passed to `startCheckout`.** The SDK returns the one-time token through that
    callback. `onPayClick(oneTimeToken)` isn't connected to anything.
11. **`continuePayment()` is never called.** PIX QR, OXXO voucher, 3DS and redirects all need it.
12. **Only `SUCCEEDED` counts as success.** A `PENDING` PIX/OXXO payment is shown as an error.
13. **There is no webhook and no server-side status.** The browser is the only thing that would learn the outcome,
    and the shopper may close the tab. Nothing ever moves the order to "paid".

### Why QA was charged twice

14. **No `X-Idempotency-Key`**, no order-level guard, and the Pay button is never disabled. Two clicks → two
    one-time tokens → two payments.

### Other defects

15. `onPayClick` uses `cart`, which isn't in scope → `ReferenceError: cart is not defined`. `showSuccess` / `showError` don't exist either.
16. Create Payment is missing `public-api-key`, `account_id`, `merchant_order_id`, `country` and `workflow`.
17. Backend `/api/create-payment` **trusts the amount from the client** (a shopper can pay R$ 1 for anything), has no
    idempotency, and returns Yuno's errors with **HTTP 200**, which hides failures. A network error throws an unhandled rejection.

## What is fine (the noise)

- **The public key in the frontend.** It is meant to be public; it only initializes the SDK.
- **The idea of a backend `/api/create-payment` route.** That is exactly where payment creation belongs; it just needs to be done properly.
- `showLoading: false` is cosmetic.

See `../../README.md` for how each item is fixed in `apps/fixed`.
