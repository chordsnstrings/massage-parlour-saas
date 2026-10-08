// `inbox` namespace (TH). Mirrors en/inbox.ts — a missing or extra key is a type error.
import type { Messages } from '../types'

export const inbox: Messages['inbox'] = {}
