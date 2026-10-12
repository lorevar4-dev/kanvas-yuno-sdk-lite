// Creates .env from .env.example if it does not exist yet.
import { copyFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const target = `${root}.env`

if (existsSync(target)) {
  console.log('.env already exists — leaving it untouched.')
} else {
  copyFileSync(`${root}.env.example`, target)
  console.log('Created .env from .env.example (YUNO_MODE=mock).')
}
