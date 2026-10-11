// `enquiries` namespace (TH, F15). Mirrors en/enquiries.ts — a missing or extra key is a type error.
// Thai copy needs native review.
import type { Messages } from '../types'

export const enquiries: Messages['enquiries'] = {
  title: 'ข้อความจากเว็บไซต์',
  nav: 'ข้อความจากเว็บ',
  description: 'ข้อความจากแบบฟอร์มติดต่อบนเว็บไซต์ของคุณ ตอบกลับทาง WhatsApp — ไม่มีการส่งอีเมลถึงลูกค้า',
  filter: { new: 'ใหม่', replied: 'ตอบแล้ว', closed: 'ปิดแล้ว', all: 'ทั้งหมด' },
  filterLabel: 'แสดง',
  search: 'ค้นหาชื่อ เบอร์โทร หรือข้อความ',
  searchButton: 'ค้นหา',
  colFrom: 'จาก',
  colMessage: 'ข้อความ',
  colReceived: 'ได้รับเมื่อ',
  colStatus: 'สถานะ',
  fromPage: 'จากหน้า {page}',
  homePage: 'หน้าแรก',
  arabic: 'เขียนเป็นภาษาอาหรับ',
  reply: 'ตอบทาง WhatsApp',
  replyLabel: 'ตอบ {name} ทาง WhatsApp',
  markReplied: 'ทำเครื่องหมายว่าตอบแล้ว',
  close: 'ปิด',
  reopen: 'เปิดอีกครั้ง',
  phoneHidden: 'ซ่อนเบอร์โทร',
  emptyTitle: 'ยังไม่มีข้อความ',
  empty: 'เมื่อลูกค้าส่งข้อความจากเว็บไซต์ของคุณ ข้อความจะแสดงที่นี่',
  emptyFilter: 'ไม่พบข้อความที่ตรงกัน',
  total: { other: '{count} ข้อความ' },
  moved: 'อัปเดตข้อความแล้ว',
}
