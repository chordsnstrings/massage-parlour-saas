// Console page group "tenants" (R22, AR). Mirrors en/tenants.ts — a missing or extra key is a type error.
// Owned by that group's conversion; glossary + tone: docs/design/console-i18n.md.
import type { Widen } from '../../types'
import type { domainErrors as en } from '../en/tenants'
import type { ConsoleMessages } from '../types'

export const tenants: ConsoleMessages['tenants'] = {
  title: 'مراكز السبا',
  description:
    'الاشتراكات والاستخدام والصلاحيات لكل مركز. إجماليات على مستوى المركز فقط — دون بيانات العملاء.',
}

export const domainErrors: Widen<typeof en> = {}
