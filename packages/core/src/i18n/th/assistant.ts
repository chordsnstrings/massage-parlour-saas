// `assistant` namespace (TH). Mirrors en/assistant.ts — a missing or extra key is a type error.
// New strings (2026-10-10): pending the owner's native Thai review.
import type { Messages } from '../types'

export const assistant: Messages['assistant'] = {
  open: 'ถาม AI',
  openLabel: 'ถาม AI เรื่องสปาของคุณ',
  title: 'ถาม AI',
  subtitle: 'ถามเรื่องสปาของคุณ ตอบจากข้อมูลของคุณเอง อ่านอย่างเดียว',
  close: 'ปิดถาม AI',
  newChat: 'แชทใหม่',
  you: 'คุณ',
  ai: 'AI',
  placeholder: 'ถามเรื่องการจอง ลูกค้า ยอดขาย หรือกะงาน…',
  question: 'คำถามของคุณ',
  send: 'ถาม',
  thinking: 'กำลังค้นหาข้อมูล…',
  disclaimer: 'AI อาจผิดพลาดได้ โปรดตรวจตัวเลขสำคัญในหน้าที่ลิงก์ไว้ก่อนตัดสินใจ',
  intro: 'ลองถามแบบนี้:',
  suggestions: {
    tomorrow: 'พรุ่งนี้มีการจองกี่รายการ?',
    topMonth: 'ทรีตเมนต์ขายดีที่สุดเดือนนี้คืออะไร?',
    lapsed: 'ลูกค้าคนไหนไม่กลับมาใช้บริการเกิน 60 วัน?',
    revenue: 'รายได้สัปดาห์ที่แล้วเทียบกับสัปดาห์ก่อนหน้า?',
    friday: 'วันศุกร์ใครเข้ากะบ้าง?',
  },
  links: 'เปิด',
  link: {
    calendar: 'ปฏิทิน · {date}',
    bookings: 'การจอง',
    reports: 'รายงาน',
    overview: 'แดชบอร์ด',
    clients: 'ลูกค้า',
    client: '{name}',
    staff: 'พนักงาน',
    whatsapp: 'ร่าง WhatsApp · {name}',
  },
  whatsappNote: 'เปิด WhatsApp พร้อมข้อความที่ร่างไว้ จะยังไม่ส่งจนกว่าคุณจะกดส่งเอง',
  incomplete: 'ตอบคำถามนี้ไม่สำเร็จ ลองถามให้สั้นลงหรือเจาะจงขึ้น',
  errors: {
    question: 'พิมพ์คำถาม (ไม่เกิน 500 ตัวอักษร)',
    off: 'แพลตฟอร์มยังไม่ได้ตั้งค่า AI',
    rate: 'คุณถามหลายคำถามในเวลาสั้น ๆ โปรดลองใหม่ภายหลัง',
    budget: 'โควตา AI ของเดือนนี้หมดแล้ว โปรดให้เจ้าของติดต่อเราเพื่อเพิ่มโควตา',
    paused: 'ขณะนี้ AI ถูกปิดสำหรับสปานี้',
    disabled: 'ขณะนี้ถาม AI ถูกปิดอยู่',
    plan: 'ถาม AI เป็นส่วนหนึ่งของแพ็กเกจ Premium',
    busy: 'AI ไม่ว่างในขณะนี้ โปรดลองใหม่อีกครั้ง',
  },
  upsell: {
    title: 'ถาม AI เป็นส่วนหนึ่งของ Premium',
    text: 'ถามเรื่องสปาของคุณด้วยภาษาธรรมดา เช่น การจองพรุ่งนี้ ทรีตเมนต์ขายดี ลูกค้าที่ควรชวนกลับมา รายได้รายสัปดาห์ หรือใครเข้ากะ แล้วไปยังหน้าที่เกี่ยวข้องได้ทันที',
  },
}
