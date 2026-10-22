// F15 blog post body (plain text → blocks). Pure + client-safe (rendered by the BlogPost site block).
/**
 * Post body → blocks for rendering: blank line = new paragraph, a line starting with `## ` = sub-heading, lines
 * starting with `- ` = a bullet list. Plain text only (rendered as React text, never HTML).
 */
export type PostBlock =
  | { kind: 'h2'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
export function postBlocks(body: string): PostBlock[] {
  const out: PostBlock[] = []
  for (const chunk of body.split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((l) => l.trimEnd())
    let para: string[] = []
    let list: string[] = []
    const flush = () => {
      if (para.length) out.push({ kind: 'p', text: para.join('\n').trim() })
      if (list.length) out.push({ kind: 'ul', items: list })
      para = []
      list = []
    }
    for (const line of lines) {
      const t = line.trim()
      if (!t) continue
      if (t.startsWith('## ')) {
        flush()
        out.push({ kind: 'h2', text: t.slice(3).trim() })
      } else if (/^[-•]\s+/.test(t)) {
        if (para.length) {
          out.push({ kind: 'p', text: para.join('\n').trim() })
          para = []
        }
        list.push(t.replace(/^[-•]\s+/, ''))
      } else {
        if (list.length) {
          out.push({ kind: 'ul', items: list })
          list = []
        }
        para.push(t)
      }
    }
    flush()
  }
  return out.filter((b) => (b.kind === 'ul' ? b.items.length > 0 : b.text.length > 0))
}
