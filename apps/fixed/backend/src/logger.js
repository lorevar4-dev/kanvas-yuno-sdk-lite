const C = { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', bold: '\x1b[1m', reset: '\x1b[0m' }
const ts = () => new Date().toISOString().slice(11, 19)

function line(color, tag, message) {
  console.log(`${C.dim}${ts()}${C.reset} ${C.green}[FIXED-BE]${C.reset} ${color}${tag.padEnd(9)}${C.reset} ${message}`)
}

export const log = {
  info: (msg) => line(C.dim, 'info', msg),
  api: (msg) => line(C.blue, 'api', msg),
  yuno: (msg) => line(C.magenta, 'yuno', msg),
  webhook: (msg) => line(C.cyan, 'webhook', msg),
  order: (msg) => line(C.bold, 'order', msg),
  ok: (msg) => line(C.green, 'ok', msg),
  warn: (msg) => line(C.yellow, 'warn', msg),
  error: (msg) => line(C.red, 'error', msg),
}

export const paint = C
