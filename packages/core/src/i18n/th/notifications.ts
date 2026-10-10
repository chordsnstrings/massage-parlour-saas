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
    enquiry: {
      site: { title: 'มีข้อความใหม่จากเว็บไซต์', body: '{name}: {message}' },
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
      budget_warning: {
        title: 'ใช้งบ AI ไปแล้ว {percent}%',
        body: 'ใช้ไป USD {spent} จาก USD {budget} ในเดือนนี้ AI จะหยุดเมื่อใช้งบครบ — ติดต่อเราเพื่อเพิ่มงบ',
      },
      budget_reached: {
        title: 'AI หยุดชั่วคราว: ใช้งบ AI ประจำเดือนครบแล้ว',
        body: 'ใช้งบครบ USD {budget} ในเดือนนี้ ฟีเจอร์ AI จะกลับมาในวันที่ 1 — ติดต่อเราเพื่อเพิ่มงบ',
      },
    },
    billing: {
      overdue: { title: 'ใบแจ้งหนี้เกินกำหนด', body: '{number} · {amount} ครบกำหนดเมื่อ {date}' },
      reminder: { title: 'แจ้งเตือนการชำระเงิน', body: 'ยอด {amount} ถึงกำหนดชำระ — เปิดหน้าการชำระเงินเพื่อจ่าย' },
    },
    weekly_insights: { title: 'สรุปข้อมูลเชิงลึกประจำสัปดาห์พร้อมแล้ว', body: '{headline}' },
    daily_digest: {
      title: { other: 'วันนี้: {count} การจอง' },
      body: '{detail}',
    },
  },
  digest: {
    insightsFallback: 'ดูว่าสัปดาห์ที่แล้วมีอะไรเปลี่ยนไป และสองสิ่งที่ควรลองในสัปดาห์นี้',
    pending: { other: 'ยังรอการยืนยัน {count} รายการ — ยืนยันทาง WhatsApp' },
    allConfirmed: 'ยืนยันครบทุกรายการแล้ว ขอให้เป็นวันที่สบาย ๆ',
  },
}
