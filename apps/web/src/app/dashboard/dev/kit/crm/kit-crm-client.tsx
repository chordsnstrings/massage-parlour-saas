'use client'
import { useState } from 'react'
import { Seg, Toggle } from '@/components/crm'

export function CrmKitInteractive() {
  const [view, setView] = useState('week')
  const [on, setOn] = useState(true)
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Seg
        label="Calendar view"
        value={view}
        onChange={setView}
        items={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
        ]}
      />
      <Toggle label="Reminder messages" checked={on} onChange={setOn} />
      <Toggle label="Birthday messages" defaultChecked={false} />
      <Toggle label="Disabled" disabled defaultChecked />
    </div>
  )
}
