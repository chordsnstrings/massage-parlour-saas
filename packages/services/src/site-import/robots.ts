// robots.txt (RFC 9309) for the Studio site import (F32): which group applies to our bot, and whether a path may be
// fetched. Pure.

export type RobotsRule = { allow: boolean; pattern: string }
export type RobotsGroup = { agents: string[]; rules: RobotsRule[] }

/** Parses robots.txt into groups (consecutive user-agent lines share the rules that follow). */
export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = []
  let current: RobotsGroup | null = null
  let lastWasAgent = false
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!m) continue
    const key = m[1]!.toLowerCase()
    const value = m[2]!.trim()
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current) continue
    if (key === 'allow' || key === 'disallow') {
      // An empty Disallow allows everything (it adds no rule).
      if (value) current.rules.push({ allow: key === 'allow', pattern: value })
    }
  }
  return groups
}

/** RFC 9309 path pattern: `*` = any run of characters, a trailing `$` = end of the path. */
function matches(pattern: string, path: string) {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const re = new RegExp(
    `^${body
      .split('*')
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}${anchored ? '$' : ''}`,
  )
  return re.test(path)
}

const normalisePath = (p: string) => {
  try {
    return decodeURI(p)
  } catch {
    return p
  }
}

/**
 * True when `path` (path + query) may be fetched by `token`: the group naming our product token (case-insensitive)
 * wins over `*`; within it the longest matching rule decides, and on a tie Allow wins. No group / no rule = allowed.
 */
export function robotsAllows(groups: RobotsGroup[], token: string, path: string): boolean {
  const t = token.toLowerCase()
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && t.startsWith(a)))
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'))
  const rules = chosen.flatMap((g) => g.rules)
  const target = normalisePath(path || '/')
  let best: RobotsRule | null = null
  for (const r of rules) {
    const pattern = normalisePath(r.pattern)
    if (!matches(pattern, target)) continue
    const len = pattern.replace(/\*|\$$/g, '').length
    const bestLen = best ? normalisePath(best.pattern).replace(/\*|\$$/g, '').length : -1
    if (len > bestLen || (len === bestLen && r.allow && best && !best.allow)) best = r
  }
  return best ? best.allow : true
}
