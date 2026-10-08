// `notifications` namespace (TH). Mirrors en/notifications.ts — a missing or extra key is a type error.
import type { Messages } from '../types'

export const notifications: Messages['notifications'] = {
  title: 'การแจ้งเตือน',
  description: 'การจองออนไลน์ สต็อก เอกสาร ร่างจาก AI และการชำระเงิน — ทุกอย่างที่ต้องดู',
  bell: 'การแจ้งเตือน',
  bellUnread: { other: 'การแจ้งเตือน ยังไม่อ่าน {count} รายการ' },
  markAll: 'ทำเครื่องหมายว่าอ่านแล้วทั้งหมด',
  markRead: 'ทำเครื่องหมายว่าอ่านแล้ว',
  viewAll: 'ดูการแจ้งเตือนทั้งหมด',
  older: 'การแจ้งเตือนก่อนหน้า',
  allRead: 'ทำเครื่องหมายว่าอ่านแล้วทั้งหมดแล้ว',
  emptyTitle: 'ไม่มีอะไรค้างอยู่',
  empty: 'การจองออนไลน์ใหม่ สต็อกใกล้หมด เอกสารใกล้หมดอายุ และร่างจาก AI จะแสดงที่นี่',
  unread: 'ยังไม่อ่าน',
  filter: { all: 'ทั้งหมด', unread: 'ยังไม่อ่าน' },
  warehouse: 'คลังสินค้า',
  unknown: 'การแจ้งเตือน',
  kind: {
    booking: {
      online: { title: 'มีการจองออนไลน์ใหม่', body: '{name} · {service} · {at} — รอการยืนยัน' },
      pending: { title: 'การจองรอการยืนยัน', body: '{name} · {service} · {at} — ยืนยันทาง WhatsApp' },
    },
    stock: {
      low: { title: { other: 'สต็อกใกล้หมดที่ {location}: {count} รายการ' }, body: '{products}' },
    },
    document: {
      expiry: {
        title: { other: 'เอกสาร {count} รายการต้องต่ออายุ' },
        body: { other: '{name} — หมดอายุ {date} และอีก {more} รายการ' },
      },
    },
    ai: {
      drafts: {
        title: { other: 'ร่างจาก AI {count} รายการรอการอนุมัติ' },
        body: 'โพสต์ Instagram: {posts} · คำตอบรีวิว: {replies}',
      },
    },
    billing: {
      overdue: { title: 'ใบแจ้งหนี้เกินกำหนด', body: '{number} · {amount} ครบกำหนดเมื่อ {date}' },
      reminder: { title: 'แจ้งเตือนการชำระเงิน', body: 'ยอด {amount} ถึงกำหนดชำระ — เปิดหน้าการชำระเงินเพื่อจ่าย' },
    },
  },
}
