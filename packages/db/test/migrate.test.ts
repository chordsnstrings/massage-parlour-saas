import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { closeAllDbs, createDb } from '../src/client'
import { assertNoSkippedMigrations, migrationUrl, readJournal, skippedMigrations } from '../src/migrate'
import { testUrls } from '../src/testing'

const folder = fileURLToPath(new URL('../drizzle', import.meta.url))

describe('migrationUrl (G7)', () => {
  it('adds lock and statement timeouts, keeping existing options', () => {
    const u = new URL(migrationUrl('postgres://o:p@db:5432/spa?options=-c%20search_path%3Dpublic', {}))
    expect(u.searchParams.get('options')).toBe(
      '-c search_path=public -c lock_timeout=10s -c statement_timeout=15min',
    )
    const custom = new URL(migrationUrl('postgres://o:p@db/spa', { MIGRATE_LOCK_TIMEOUT: '3s' }))
    expect(custom.searchParams.get('options')).toContain('lock_timeout=3s')
  })
})

describe('migration journal (merges from parallel branches)', () => {
  const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8')).entries as Array<{
    idx: number
    tag: string
    when: number
  }>

  it('numbers migrations 0..n once each, tag prefix = idx, `when` strictly increasing', () => {
    journal.forEach((e, i) => {
      expect(e.idx).toBe(i)
      expect(e.tag.startsWith(`${String(i).padStart(4, '0')}_`)).toBe(true)
      if (i)
        expect(e.when, `${e.tag} must be newer than ${journal[i - 1]!.tag}`).toBeGreaterThan(
          journal[i - 1]!.when,
        )
    })
  })

  it('has exactly one SQL file and one snapshot per entry, chained by prevId', () => {
    const sqlFiles = readdirSync(folder).filter((f) => f.endsWith('.sql'))
    expect(sqlFiles.sort()).toEqual(journal.map((e) => `${e.tag}.sql`).sort())
    const snapshots = readdirSync(join(folder, 'meta')).filter((f) => f.endsWith('_snapshot.json'))
    expect(snapshots.sort()).toEqual(journal.map((e) => `${e.tag.slice(0, 4)}_snapshot.json`).sort())
    let prev: string | undefined
    for (const e of journal) {
      const snap = JSON.parse(readFileSync(join(folder, `meta/${e.tag.slice(0, 4)}_snapshot.json`), 'utf8'))
      if (prev) expect(snap.prevId, `${e.tag} snapshot must chain on the previous one`).toBe(prev)
      prev = snap.id
    }
  })
})

describe('skippedMigrations', () => {
  const m = (tag: string, when: number) => ({ tag, when, hash: `h-${tag}` })
  const row = (tag: string, when: number) => ({ hash: `h-${tag}`, created_at: String(when) })

  it('flags a merged migration older than the newest applied one (Drizzle would skip it)', () => {
    const journal = [m('0032_a', 10), m('0033_other_branch', 30), m('0034_renumbered', 20)]
    expect(skippedMigrations(journal, [row('0032_a', 10), row('0033_other_branch', 30)])).toEqual([
      '0034_renumbered',
    ])
  })
  it('passes fresh databases, pending newer migrations and rewritten-but-applied ones', () => {
    const journal = [m('0000_a', 1), m('0001_b', 2), m('0002_c', 3)]
    expect(skippedMigrations(journal, [])).toEqual([])
    expect(skippedMigrations(journal, [row('0000_a', 1)])).toEqual([])
    // same `when`, edited SQL (different hash) still counts as applied
    expect(skippedMigrations(journal, [{ hash: 'old', created_at: 1 }, row('0001_b', 2)])).toEqual([])
  })
  it('reads hashes for every journal entry of the real folder', () => {
    const real = readJournal(folder)
    expect(real.length).toBeGreaterThan(30)
    expect(real.every((e) => /^[0-9a-f]{64}$/.test(e.hash))).toBe(true)
  })
})

describe('assertNoSkippedMigrations (DB)', () => {
  const schema = 'drizzle_skip_guard_test'
  const db = createDb(testUrls.owner, 1)
  afterAll(async () => {
    await db.execute(sql.raw(`drop schema if exists ${schema} cascade`))
    await closeAllDbs()
  })

  it('refuses before migrating when a journal entry is older than the newest applied row', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'))
    mkdirSync(join(dir, 'meta'))
    const entries = [
      { idx: 0, version: '7', when: 100, tag: '0000_base', breakpoints: true },
      { idx: 1, version: '7', when: 300, tag: '0001_other_branch', breakpoints: true },
      { idx: 2, version: '7', when: 200, tag: '0002_maps', breakpoints: true },
    ]
    for (const e of entries) writeFileSync(join(dir, `${e.tag}.sql`), `select ${e.idx};`)
    writeFileSync(
      join(dir, 'meta/_journal.json'),
      JSON.stringify({ version: '7', dialect: 'postgresql', entries }),
    )
    const [base, other] = readJournal(dir)
    await db.execute(sql.raw(`drop schema if exists ${schema} cascade; create schema ${schema}`))
    // no migrations table yet: nothing to check
    await expect(assertNoSkippedMigrations(db, dir, schema)).resolves.toBeUndefined()
    await db.execute(
      sql.raw(`create table ${schema}.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint);
        insert into ${schema}.__drizzle_migrations (hash, created_at) values ('${base!.hash}', 100), ('${other!.hash}', 300)`),
    )
    await expect(assertNoSkippedMigrations(db, dir, schema)).rejects.toThrow(/0002_maps .*would be skipped/)
    await db.execute(
      sql.raw(`insert into ${schema}.__drizzle_migrations (hash, created_at) values ('x', 200)`),
    )
    await expect(assertNoSkippedMigrations(db, dir, schema)).resolves.toBeUndefined()
  })
})
