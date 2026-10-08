'use client'
import { X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useT } from '@/i18n/client'
import { cn } from '@/lib/utils'

/** Bottom sheet on phones, centred dialog on md+. */
export function Sheet({
  trigger,
  title,
  description,
  children,
  open,
  onOpenChange,
  className,
}: {
  trigger?: React.ReactNode
  title: string
  description?: string
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}) {
  const t = useT()
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px] data-[state=closed]:pointer-events-none data-[state=closed]:anim-fade-out data-[state=open]:anim-fade-in" />
        <Dialog.Content
          className={cn(
            // While it animates out a closed sheet ignores clicks, so a quick second click can't resubmit its form.
            'fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-2xl border bg-surface pb-safe shadow-pop data-[state=closed]:pointer-events-none data-[state=closed]:anim-sheet-down data-[state=open]:anim-sheet-up',
            'md:inset-auto md:top-1/2 md:left-1/2 md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:pb-0 md:data-[state=open]:anim-pop-in md:data-[state=closed]:anim-fade-out',
            className,
          )}
        >
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-border md:hidden" />
          <div className="flex items-start justify-between gap-4 px-6 pt-5">
            <div className="space-y-1">
              <Dialog.Title className="text-base font-semibold tracking-tight">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-sm text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              className="rounded-md p-1 text-muted transition-colors hover:bg-subtle hover:text-fg"
              aria-label={t('ui.close')}
            >
              <X className="size-4" strokeWidth={1.5} />
            </Dialog.Close>
          </div>
          <div className="px-6 pt-4 pb-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export const SheetClose = Dialog.Close
