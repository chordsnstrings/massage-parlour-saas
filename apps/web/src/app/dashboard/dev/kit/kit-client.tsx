'use client'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'

export function KitInteractive() {
  return (
    <div className="flex flex-wrap gap-3">
      <Button variant="secondary" onClick={() => toast.success('Saved — this is a success toast')}>
        Success toast
      </Button>
      <Button variant="secondary" onClick={() => toast.error('Something needs attention')}>
        Error toast
      </Button>
      <Sheet
        title="Sheet"
        description="Bottom sheet on phones, dialog on desktop."
        trigger={<Button variant="secondary">Open sheet</Button>}
      >
        <div className="space-y-4">
          <Field label="Example" name="example">
            <Input id="example" placeholder="Type something" />
          </Field>
          <Button className="w-full">Primary action</Button>
        </div>
      </Sheet>
    </div>
  )
}
