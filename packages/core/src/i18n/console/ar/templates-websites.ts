// Console page group "templates-websites" (R22, AR). Mirrors en/templates-websites.ts — a missing or extra key is a type error.
// Owned by that group's conversion; glossary + tone: docs/design/console-i18n.md.
import type { Widen } from '../../types'
import type { domainErrors as en } from '../en/templates-websites'
import type { ConsoleMessages } from '../types'

export const templates: ConsoleMessages['templates'] = {
  title: 'قوالب المواقع',
  description:
    'قوالب يمكن لمراكز السبا اختيارها إلى جانب القوالب الثمانية المدمجة. قالب الاستوديو الذي يحمل مفتاح قالب مدمج يحلّ محله.',
}

export const websites: ConsoleMessages['websites'] = {
  title: 'المواقع',
  description: 'يُبنى موقع كل مركز هنا كخدمة مخصصة. افتح الاستوديو للتصميم، ثم أرسله للمراجعة.',
}

export const domainErrors: Widen<typeof en> = {}
