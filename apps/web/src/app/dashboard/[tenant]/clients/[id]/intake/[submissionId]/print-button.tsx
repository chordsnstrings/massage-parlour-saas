'use client'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function PrintButton() {
  return (
    <Button variant="secondary" onClick={() => window.print()}>
      <Printer /> Print or save PDF
    </Button>
  )
}
