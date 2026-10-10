// Types of the console catalogue (R22): EN is the source of truth, AR must match its shape (a missing or extra key is
// a type error), keys are type-checked dotted paths.
import type { Translator } from '../translate'
import type { ConsoleLocale, Params, Paths, Widen } from '../types'
import type { consoleEn } from './en'

export type ConsoleMessages = Widen<typeof consoleEn>
/** Dotted key of any console message, e.g. `chrome.nav.overview`, `home.health.title`. */
export type ConsoleKey = Paths<typeof consoleEn>
/** A console message reference that travels across the server/client boundary (action results). */
export type ConsoleMessageRef = { key: ConsoleKey; params?: Params<ConsoleKey> }

/** The console's translator: console keys, EN or AR. */
export type ConsoleTranslator = Translator<ConsoleKey, ConsoleLocale>
