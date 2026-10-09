// `search` namespace (TH). Mirrors en/search.ts — a missing or extra key is a type error.
import type { Messages } from '../types'

export const search: Messages['search'] = {
  open: 'ค้นหา',
  placeholder: 'ค้นหาลูกค้า การจอง ใบเสร็จ…',
  dialog: 'ค้นหาในสปา',
  input: 'ค้นหา',
  hint: 'พิมพ์อย่างน้อย 2 ตัวอักษร — ชื่อ เบอร์โทร รหัสการจอง หรือเลขที่ใบเสร็จ',
  hintNoPhone: 'พิมพ์อย่างน้อย 2 ตัวอักษร — ชื่อ รหัสการจอง หรือเลขที่ใบเสร็จ',
  loading: 'กำลังค้นหา…',
  empty: 'ไม่พบผลลัพธ์สำหรับ “{q}”',
  error: 'ค้นหาไม่สำเร็จ ลองอีกครั้ง',
  more: 'แสดงเพิ่มเติม',
  keys: '↑ ↓ เลื่อน · Enter เปิด · Esc ปิด',
  close: 'ปิดการค้นหา',
  group: {
    clients: 'ลูกค้า',
    bookings: 'การจอง',
    sales: 'ใบเสร็จ',
    staff: 'พนักงาน',
    services: 'บริการ',
  },
  hit: {
    receipt: 'ใบเสร็จ #{number}',
    walkIn: 'วอล์กอิน',
    lastVisit: 'มาครั้งล่าสุด {date}',
    newClient: 'ยังไม่เคยมาใช้บริการ',
  },
}
