import type { Messages } from '../types'

// Needs native review (docs/PLAN.md §14.6). iOS menu wording follows Thai iOS ("เพิ่มไปยังหน้าจอโฮม").
export const pwa: Messages['pwa'] = {
  install: 'ติดตั้งแอป',
  ios: {
    title: 'ติดตั้ง {app}',
    description: 'เพิ่ม {app} ไปยังหน้าจอโฮม แล้วเปิดใช้งานได้เหมือนแอปทั่วไป',
    share: 'แตะปุ่มแชร์ในแถบเครื่องมือของเบราว์เซอร์',
    add: 'เลื่อนลงแล้วแตะ “เพิ่มไปยังหน้าจอโฮม”',
    confirm: 'แตะ “เพิ่ม” แล้ว {app} จะปรากฏบนหน้าจอโฮม',
    done: 'เข้าใจแล้ว',
  },
  tip: {
    title: 'ติดตั้ง {app}',
    body: 'เปิดสปาของคุณได้ในแตะเดียว แบบเต็มหน้าจอ ทั้งบนโทรศัพท์และคอมพิวเตอร์ ไม่ต้องโหลดจาก App Store',
    install: 'ติดตั้งแอป',
    howTo: 'ดูวิธีติดตั้ง',
    dismiss: 'ไว้ทีหลัง',
  },
  offline: {
    title: 'คุณออฟไลน์อยู่',
    body: 'เชื่อมต่ออินเทอร์เน็ตเพื่อใช้งานต่อ',
    retry: 'ลองอีกครั้ง',
  },
}
