/** Structured JSON logs (one line per event) for `docker logs` / log shippers. */
export const log = (level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}) =>
  console[level](JSON.stringify({ level, msg, time: new Date().toISOString(), ...extra }))
