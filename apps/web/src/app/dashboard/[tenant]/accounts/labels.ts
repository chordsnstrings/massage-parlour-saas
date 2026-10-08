import type { Translator } from '@spa/core/i18n'

/** Default-chart ledger account name in the viewer's language; other (custom) accounts keep their stored name. */
export const accountName = (t: Translator, code: string, name: string) =>
  t.maybe(`accounts.ledger.a${code}`) ?? name

/** Journal entry source (`journal_entries.source_type`) label; unknown types print as-is. */
export const sourceLabel = (t: Translator, source: string) => t.maybe(`accounts.source.${source}`) ?? source
