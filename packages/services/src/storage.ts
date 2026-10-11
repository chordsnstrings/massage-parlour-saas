// File storage: bytes in Postgres (`stored_files.bytes`, fine for a small spa's images and receipts) unless an
// S3-compatible bucket is configured (Cloudflare R2 / DigitalOcean Spaces): S3_ENDPOINT, S3_BUCKET,
// S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (+ optional S3_REGION). Callers always go through these helpers.
import { storedFiles, type Tx } from '@spa/db'
import { AwsClient } from 'aws4fetch'
import { eq } from 'drizzle-orm'
import { DomainError } from './errors'

export const MAX_FILE_BYTES = 8 * 1024 * 1024
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'] as const

type S3 = { client: AwsClient; endpoint: string; bucket: string }
function s3(): S3 | null {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION } = process.env
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null
  return {
    client: new AwsClient({
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
      service: 's3',
      region: S3_REGION ?? 'auto',
    }),
    endpoint: S3_ENDPOINT.replace(/\/$/, ''),
    bucket: S3_BUCKET,
  }
}

export type PutFile = {
  tenantId: string
  bytes: Buffer
  contentType: string
  filename?: string | null
  isPublic?: boolean
  purpose?: string
  createdBy?: string | null
}

/** Stores a file (inside the caller's tenant transaction) and returns its row (without bytes). */
export async function putFile(tx: Tx, f: PutFile) {
  if (f.bytes.length === 0)
    throw new DomainError('The file is empty', 'invalid', { key: 'errors.file.empty' })
  if (f.bytes.length > MAX_FILE_BYTES)
    throw new DomainError('Files can be up to 8 MB', 'invalid', {
      key: 'errors.file.tooLarge',
      params: { size: '8 MB' },
    })
  const bucket = s3()
  const [row] = await tx
    .insert(storedFiles)
    .values({
      tenantId: f.tenantId,
      storage: bucket ? 's3' : 'db',
      bytes: bucket ? null : f.bytes,
      contentType: f.contentType,
      size: f.bytes.length,
      filename: f.filename ?? null,
      isPublic: f.isPublic ?? false,
      purpose: f.purpose ?? 'media',
      createdBy: f.createdBy ?? null,
    })
    .returning({ id: storedFiles.id })
  if (bucket) {
    const objectKey = `${f.tenantId}/${row!.id}`
    const res = await bucket.client.fetch(`${bucket.endpoint}/${bucket.bucket}/${objectKey}`, {
      method: 'PUT',
      body: new Uint8Array(f.bytes),
      headers: { 'content-type': f.contentType },
    })
    if (!res.ok) throw new Error(`Upload failed (${res.status})`)
    await tx.update(storedFiles).set({ objectKey }).where(eq(storedFiles.id, row!.id))
  }
  return { id: row!.id, size: f.bytes.length, contentType: f.contentType }
}

/** Reads a file's bytes. `tx` may be a tenant transaction or the platform db (public file route). */
export async function getFile(tx: Pick<Tx, 'select'>, id: string) {
  const [row] = await tx.select().from(storedFiles).where(eq(storedFiles.id, id))
  if (!row) return null
  let bytes = row.bytes
  if (row.storage === 's3' && row.objectKey) {
    const bucket = s3()
    if (!bucket) throw new Error('S3 storage is not configured')
    const res = await bucket.client.fetch(`${bucket.endpoint}/${bucket.bucket}/${row.objectKey}`)
    if (!res.ok) throw new Error(`Download failed (${res.status})`)
    bytes = Buffer.from(await res.arrayBuffer())
  }
  return { ...row, bytes: bytes ?? Buffer.alloc(0) }
}

export async function deleteFile(tx: Tx, id: string) {
  const [row] = await tx.delete(storedFiles).where(eq(storedFiles.id, id)).returning()
  const bucket = s3()
  if (row?.storage === 's3' && row.objectKey && bucket)
    await bucket.client.fetch(`${bucket.endpoint}/${bucket.bucket}/${row.objectKey}`, { method: 'DELETE' })
  return Boolean(row)
}

const xmlText = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

/**
 * G12 tenant purge: deletes every bucket object under `<tenantId>/` (ListObjectsV2 pages, then one DELETE per
 * object — no Content-MD5 needed). No bucket configured → nothing to do. Failures are returned, not thrown.
 */
export async function deleteTenantObjects(tenantId: string) {
  const bucket = s3()
  const out = { deleted: 0, errors: [] as string[] }
  if (!bucket) return out
  const base = `${bucket.endpoint}/${bucket.bucket}`
  const prefix = `${tenantId}/`
  let token: string | null = null
  for (let page = 0; page < 1000; page++) {
    const qs = new URLSearchParams({ 'list-type': '2', prefix })
    if (token) qs.set('continuation-token', token)
    const res = await bucket.client.fetch(`${base}?${qs}`)
    if (!res.ok) {
      out.errors.push(`list objects failed (${res.status})`)
      break
    }
    const xml = await res.text()
    const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => xmlText(m[1]!))
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue
      const path = key.split('/').map(encodeURIComponent).join('/')
      const del = await bucket.client.fetch(`${base}/${path}`, { method: 'DELETE' })
      if (del.ok || del.status === 404) out.deleted++
      else out.errors.push(`delete ${key} failed (${del.status})`)
    }
    const next = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1]
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) && next ? xmlText(next) : null
    if (!token) break
  }
  return out
}
