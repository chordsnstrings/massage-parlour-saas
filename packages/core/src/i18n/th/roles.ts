// `roles` namespace (TH). Mirrors en/roles.ts — a missing or extra key is a type error.
import type { Messages } from '../types'

export const roles: Messages['roles'] = {
  title: 'บทบาท',
  back: 'ทีม',
  description: 'บทบาทสำเร็จรูป 6 แบบ พร้อมบทบาทที่คุณสร้างเอง',
  system: 'ระบบ',
  custom: 'กำหนดเอง',
  permissionsCount: { other: '{count} สิทธิ์' },
  sheet: {
    new: 'บทบาทใหม่',
    fixed: 'บทบาทของระบบแก้ไขไม่ได้ สร้างบทบาทใหม่เพื่อปรับสิทธิ์',
    choose: 'เลือกสิ่งที่บทบาทนี้ทำได้',
    view: 'ดู',
    name: 'ชื่อ',
    description: 'คำอธิบาย',
    save: 'บันทึกบทบาท',
  },
  result: {
    saved: 'บันทึกบทบาทแล้ว',
    deleted: 'ลบบทบาทแล้ว',
    notFound: 'ไม่พบบทบาท',
    phoneRestricted: 'เบอร์โทรลูกค้าดูได้เฉพาะเจ้าของ ผู้จัดการ และพนักงานต้อนรับเท่านั้น',
    systemLocked: 'บทบาทของระบบแก้ไขไม่ได้ — สร้างบทบาทใหม่แทน',
    duplicate: 'มีบทบาทชื่อนี้อยู่แล้ว',
    onlyCustom: 'ลบได้เฉพาะบทบาทที่สร้างเอง',
    inUse: 'ย้ายสมาชิกออกจากบทบาทนี้ก่อน',
  },
  validation: { name: 'ตั้งชื่อบทบาท' },
}
