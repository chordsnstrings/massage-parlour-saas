'use client'
import { Loader2, ScanLine, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n/client'
import { cn } from '@/lib/utils'
import { ReceiptThumb } from './receipt-thumb'

type Fields = {
  vendor: string | null
  date: string | null
  totalAed: number | null
  vatAed: number | null
  trn: string | null
  currency: string | null
  category: string | null
}
export type Scan = {
  file: { id: string; url: string; name: string; contentType: string }
  status: string
  message: string
  fields?: Fields
  ocr?: Record<string, unknown>
}

/**
 * Receipt photo -> private file -> vision model (server/receipt-scan.ts). `version` bumps when a scan returns
 * fields, so forms can remount their inputs with the read values as defaults. Shared by expenses and purchases.
 */
export function useReceiptScan(scanUrl: string) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [scan, setScan] = useState<Scan | null>(null)
  const [version, setVersion] = useState(0)
  const picker = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    if (file.size > 8 * 1024 * 1024) {
      toast.error(t('errors.file.tooLarge', { size: '8 MB' }))
      return
    }
    setBusy(true)
    try {
      const body = new FormData()
      body.set('file', file)
      const res = await fetch(scanUrl, { method: 'POST', body })
      const data = (await res.json().catch(() => null)) as (Scan & { ok?: boolean; error?: string }) | null
      if (!res.ok || !data?.file) {
        toast.error(t.maybe(data?.error) ?? data?.error ?? t('errors.file.uploadFailed'))
        return
      }
      setScan(data)
      if (data.fields) setVersion((v) => v + 1)
    } catch {
      toast.error(t('accounts.sheet.offline'))
    } finally {
      setBusy(false)
      if (picker.current) picker.current.value = ''
    }
  }

  return { busy, scan, setScan, version, picker, upload }
}

/** The dashed "Scan receipt" box; posts `receiptFileId` + `ocr` hidden fields with the surrounding form. */
export function ReceiptScanBox({
  state: { busy, scan, setScan, picker, upload },
  aiReady,
}: {
  state: ReturnType<typeof useReceiptScan>
  aiReady: boolean
}) {
  const t = useT()
  const f = scan?.fields
  return (
    <div
      className={cn(
        'rounded-xl border border-dashed p-4 transition-colors',
        scan ? 'border-accent/40 bg-accent-soft/40' : 'bg-subtle/40',
      )}
    >
      <input
        ref={picker}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="sr-only"
        tabIndex={-1}
        aria-label={t('accounts.sheet.receiptPhoto')}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void upload(file)
        }}
      />
      <input type="hidden" name="receiptFileId" value={scan?.file.id ?? ''} />
      <input type="hidden" name="ocr" value={scan?.ocr ? JSON.stringify(scan.ocr) : ''} />
      <div className="flex items-center gap-3">
        {scan ? (
          <ReceiptThumb url={scan.file.url} label={t('accounts.expenses.viewReceipt')} />
        ) : (
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-surface text-accent">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ScanLine className="size-4" />}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {busy ? t('accounts.sheet.reading') : scan ? scan.file.name : t('accounts.sheet.have')}
          </p>
          <p className="text-[13px] text-muted">
            {scan
              ? t('accounts.sheet.attached')
              : aiReady
                ? t('accounts.sheet.snap')
                : t('accounts.sheet.attach')}
          </p>
        </div>
        {scan ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('accounts.sheet.remove')}
            className="shrink-0"
            onClick={() => setScan(null)}
          >
            <X />
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 shrink-0 sm:min-h-10"
            pending={busy}
            onClick={() => picker.current?.click()}
          >
            <ScanLine /> {t('accounts.sheet.scan')}
          </Button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {scan && (
          <motion.p
            key={scan.message}
            role="status"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className={cn(
              'text-[13px]',
              scan.status === 'read'
                ? 'text-success'
                : scan.status === 'currency'
                  ? 'text-warning'
                  : 'text-muted',
            )}
          >
            <span className="block pt-3">
              {scan.message}
              {f?.trn ? ` ${t('accounts.sheet.trn', { trn: f.trn })}` : ''}
            </span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
