// Minimal streaming .zip writer (STORE, no compression) for downloads of files that are already compressed, such
// as PDFs (F27 intake export). Entries are pulled one at a time, so memory stays at one file plus the central
// directory. Limits: < 65,535 entries and < 4 GB in total (no ZIP64) — the caller caps the export well below.
import { crc32 } from 'node:zlib'

export type ZipEntry = { name: string; bytes: Buffer; date?: Date }

/** MS-DOS date/time fields (local wall time as given; the caller passes Dubai wall time if it cares). */
function dosTime(d: Date) {
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2)
  const date =
    ((Math.max(1980, d.getUTCFullYear()) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()
  return { time, date }
}

/** Zip stream of the entries the iterator yields (names are UTF-8, flag bit 11). */
export function zipStream(entries: AsyncIterable<ZipEntry>): ReadableStream<Uint8Array> {
  const central: Buffer[] = []
  let offset = 0
  let count = 0
  const it = entries[Symbol.asyncIterator]()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await it.next()
      if (!next.done) {
        const { name, bytes } = next.value
        if (count >= 65_535 || offset + bytes.length > 0xffff_fff0) throw new Error('zip too large')
        const fileName = Buffer.from(name, 'utf8')
        const crc = crc32(bytes) >>> 0
        const { time, date } = dosTime(next.value.date ?? new Date())
        const local = Buffer.alloc(30)
        local.writeUInt32LE(0x04034b50, 0)
        local.writeUInt16LE(20, 4) // version needed
        local.writeUInt16LE(0x0800, 6) // UTF-8 names
        local.writeUInt16LE(0, 8) // STORE
        local.writeUInt16LE(time, 10)
        local.writeUInt16LE(date, 12)
        local.writeUInt32LE(crc, 14)
        local.writeUInt32LE(bytes.length, 18)
        local.writeUInt32LE(bytes.length, 22)
        local.writeUInt16LE(fileName.length, 26)
        local.writeUInt16LE(0, 28)
        const dir = Buffer.alloc(46)
        dir.writeUInt32LE(0x02014b50, 0)
        dir.writeUInt16LE(20, 4) // made by
        dir.writeUInt16LE(20, 6)
        dir.writeUInt16LE(0x0800, 8)
        dir.writeUInt16LE(0, 10)
        dir.writeUInt16LE(time, 12)
        dir.writeUInt16LE(date, 14)
        dir.writeUInt32LE(crc, 16)
        dir.writeUInt32LE(bytes.length, 20)
        dir.writeUInt32LE(bytes.length, 24)
        dir.writeUInt16LE(fileName.length, 28)
        dir.writeUInt32LE(offset, 42)
        central.push(dir, fileName)
        controller.enqueue(new Uint8Array(Buffer.concat([local, fileName, bytes])))
        offset += 30 + fileName.length + bytes.length
        count++
        return
      }
      const dirBytes = Buffer.concat(central)
      const end = Buffer.alloc(22)
      end.writeUInt32LE(0x06054b50, 0)
      end.writeUInt16LE(count, 8)
      end.writeUInt16LE(count, 10)
      end.writeUInt32LE(dirBytes.length, 12)
      end.writeUInt32LE(offset, 16)
      controller.enqueue(new Uint8Array(Buffer.concat([dirBytes, end])))
      controller.close()
    },
    async cancel() {
      await it.return?.()
    },
  })
}
