// Sends api-sandbox.y.uno calls through the Vite proxy (/yuno-api). Headers untouched.
const YUNO_API = 'https://api-sandbox.y.uno'
const realFetch = window.fetch.bind(window)

window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  if (url.startsWith(YUNO_API)) return realFetch(url.replace(YUNO_API, '/yuno-api'), init)
  return realFetch(input, init)
}
