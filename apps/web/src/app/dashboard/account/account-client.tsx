'use client'
import { authClient } from '@spa/auth/client'
import { ShieldCheck } from 'lucide-react'
import { motion } from 'motion/react'
import QRCode from 'qrcode'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { authErrorText } from '@/components/auth/errors'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n/client'

function useBusy() {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const run = async (
    fn: () => Promise<{ data?: unknown; error?: { code?: string; message?: string; status?: number } | null }>,
  ): Promise<unknown> => {
    setBusy(true)
    try {
      const res = await fn()
      if (res.error) {
        toast.error(authErrorText(t, res.error))
        return null
      }
      return res.data ?? {}
    } finally {
      setBusy(false)
    }
  }
  return { busy, run, t }
}

export function ProfileCard({ name }: { name: string }) {
  const { busy, run, t } = useBusy()
  return (
    <Card>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          const value = String(new FormData(e.currentTarget).get('name')).trim()
          if (await run(() => authClient.updateUser({ name: value }))) toast.success(t('account.profile.saved'))
        }}
      >
        <CardHeader title={t('account.profile.title')} />
        <CardBody className="space-y-1.5">
          <Label htmlFor="name">{t('account.profile.name')}</Label>
          <Input id="name" name="name" defaultValue={name} required />
        </CardBody>
        <CardFooter>
          <Button type="submit" pending={busy}>
            {t('account.profile.save')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

export function PasswordCard() {
  const { busy, run, t } = useBusy()
  return (
    <Card>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          const form = e.currentTarget
          const f = new FormData(form)
          const ok = await run(() =>
            authClient.changePassword({
              currentPassword: String(f.get('current')),
              newPassword: String(f.get('next')),
              revokeOtherSessions: true,
            }),
          )
          if (ok) {
            toast.success(t('account.password.changed'))
            form.reset()
          }
        }}
      >
        <CardHeader title={t('account.password.title')} description={t('account.password.sub')} />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="current">{t('account.password.current')}</Label>
            <Input id="current" name="current" type="password" autoComplete="current-password" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="next">{t('account.password.next')}</Label>
            <Input
              id="next"
              name="next"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
            />
          </div>
        </CardBody>
        <CardFooter>
          <Button type="submit" pending={busy}>
            {t('account.password.update')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

export function TwoFactorCard({ enabled: initial }: { enabled: boolean }) {
  const { busy, run, t } = useBusy()
  const [enabled, setEnabled] = useState(initial)
  const [setup, setSetup] = useState<{ qr: string; backupCodes: string[] } | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)

  return (
    <Card>
      <CardHeader
        title={t('account.twoFactor.title')}
        description={t('account.twoFactor.sub')}
        action={<Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? t('account.twoFactor.on') : t('account.twoFactor.off')}</Badge>}
      />
      <CardBody>
        {codes ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            <p className="text-sm text-muted">{t('account.twoFactor.backup')}</p>
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-subtle p-4 font-mono text-[13px] sm:grid-cols-5">
              {codes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={() => setCodes(null)}>
              {t('account.twoFactor.done')}
            </Button>
          </motion.div>
        ) : setup ? (
          <motion.form
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid items-center gap-6 sm:grid-cols-[auto_1fr]"
            onSubmit={async (e) => {
              e.preventDefault()
              const code = String(new FormData(e.currentTarget).get('code')).replace(/\s/g, '')
              if (await run(() => authClient.twoFactor.verifyTotp({ code }))) {
                setEnabled(true)
                setCodes(setup.backupCodes)
                setSetup(null)
                toast.success(t('account.twoFactor.enabled'))
              }
            }}
          >
            {/* biome-ignore lint/performance/noImgElement: data URL QR code */}
            <img
              src={setup.qr}
              alt={t('account.twoFactor.qrAlt')}
              className="size-40 rounded-lg border bg-white p-2"
            />
            <div className="space-y-3">
              <p className="text-sm text-muted">{t('account.twoFactor.scan')}</p>
              <Input
                name="code"
                aria-label={t('account.twoFactor.code')}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="tabular max-w-40 tracking-[0.3em]"
                required
              />
              <Button type="submit" pending={busy}>
                {t('account.twoFactor.verify')}
              </Button>
            </div>
          </motion.form>
        ) : (
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault()
              const form = e.currentTarget
              const password = String(new FormData(form).get('password'))
              if (enabled) {
                if (await run(() => authClient.twoFactor.disable({ password }))) {
                  setEnabled(false)
                  toast.success(t('account.twoFactor.disabled'))
                  form.reset()
                }
                return
              }
              const data = (await run(() => authClient.twoFactor.enable({ password }))) as {
                totpURI?: string
                backupCodes?: string[]
              } | null
              if (data?.totpURI)
                setSetup({
                  qr: await QRCode.toDataURL(data.totpURI, { margin: 1, width: 320 }),
                  backupCodes: data.backupCodes ?? [],
                })
            }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="tfa-password">{t('account.twoFactor.confirm')}</Label>
              <Input
                id="tfa-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit" variant={enabled ? 'danger' : 'primary'} pending={busy}>
              <ShieldCheck /> {enabled ? t('account.twoFactor.turnOff') : t('account.twoFactor.setUp')}
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  )
}
