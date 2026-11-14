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
    // `key: value` split at the first colon (no backtracking regex: the body comes from any site).
    const colon = line.indexOf(':')
    const key = line.slice(0, Math.max(colon, 0)).trimEnd().toLowerCase()
    if (!/^[a-z-]+$/.test(key)) continue
    const value = line.slice(colon + 1).trim()
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

/**
 * RFC 9309 path pattern: `*` = any run of characters, a trailing `$` = end of the path. A wildcard match with one
 * resume point (O(pattern × path) worst case), not a regex built from the pattern: `.*a.*a…` backtracks exponentially.
 */
function matches(pattern: string, path: string) {
  // Unanchored = a prefix match, i.e. an implicit trailing `*`.
  const p = pattern.endsWith('$') ? pattern.slice(0, -1) : `${pattern}*`
  let i = 0
  let j = 0
  let star = -1
  let resume = 0
  while (i < path.length) {
    if (p[j] === '*') {
      star = j++
      resume = i
    } else if (j < p.length && p[j] === path[i]) {
      i++
      j++
    } else if (star >= 0) {
      j = star + 1
      i = ++resume
    } else return false
  }
  while (p[j] === '*') j++
  return j === p.length
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
