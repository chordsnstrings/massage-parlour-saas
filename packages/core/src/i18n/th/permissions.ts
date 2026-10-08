// `permissions` namespace (TH). Mirrors en/permissions.ts — a missing or extra key is a type error.
import type { Messages } from '../types'

export const permissions: Messages['permissions'] = {
  groups: {
    dashboard: { label: 'แดชบอร์ด', actions: { view: 'ดูแดชบอร์ด', revenue: 'ดูตัวเลขรายได้' } },
    calendar: {
      label: 'ปฏิทินและการจอง',
      actions: { view: 'ดูปฏิทิน', manage: 'สร้างและแก้ไขการจอง', commission: 'บันทึกค่าคอมมิชชันนักบำบัด' },
    },
    clients: {
      label: 'ลูกค้า',
      actions: { view: 'ดูข้อมูลลูกค้า', manage: 'แก้ไขข้อมูลลูกค้า', phone: 'ดูเบอร์โทรศัพท์', export: 'ส่งออกรายชื่อลูกค้า' },
    },
    pos: {
      label: 'จุดขาย (POS)',
      actions: { use: 'รับชำระเงิน', refund: 'คืนเงินและยกเลิกบิล', close: 'ปิดยอดประจำวัน' },
    },
    services: { label: 'บริการและห้อง', actions: { manage: 'จัดการบริการ ห้อง และทรัพยากร' } },
    staff: { label: 'พนักงาน', actions: { view: 'ดูข้อมูลพนักงาน', manage: 'จัดการพนักงาน กะงาน และค่าตอบแทน' } },
    inventory: { label: 'คลังสินค้า', actions: { manage: 'จัดการสต็อก' } },
    marketing: {
      label: 'WhatsApp และการตลาด',
      actions: { send: 'ส่งข้อความ WhatsApp', campaigns: 'สร้างแคมเปญ' },
    },
    site: {
      label: 'เว็บไซต์',
      actions: { content: 'แก้ไขข้อความและรูปภาพ', design: 'แก้ไขดีไซน์และเลย์เอาต์', publish: 'เผยแพร่' },
    },
    reports: { label: 'รายงานและการวิเคราะห์', actions: { view: 'ดูรายงาน' } },
    accounting: { label: 'บัญชี', actions: { view: 'ดูบัญชี', manage: 'บันทึกค่าใช้จ่ายและปิดงวด' } },
    ai: { label: 'ผู้ช่วย AI', actions: { approve: 'อนุมัติร่างจาก AI', manage: 'ตั้งค่าผู้ช่วย AI' } },
    team: { label: 'ทีมและบทบาท', actions: { manage: 'เชิญสมาชิกและแก้ไขบทบาท' } },
    settings: { label: 'ตั้งค่าธุรกิจ', actions: { manage: 'แก้ไขข้อมูลธุรกิจและสาขา' } },
    billing: { label: 'การสมัครใช้งาน', actions: { view: 'ดูใบแจ้งหนี้และการชำระเงิน' } },
  },
  roleDescription: {
    owner: 'เข้าถึงได้ทั้งหมด รวมถึงการสมัครใช้งานและบทบาท',
    manager: 'ดูแลการดำเนินงานประจำวัน ทุกอย่างยกเว้นการสมัครใช้งาน',
    receptionist: 'การจอง วอล์กอิน การชำระเงิน ลูกค้า และ WhatsApp',
    therapist: 'ตารางงานของตัวเอง เช็กอิน/เช็กเอาต์ และรายได้ ไม่เห็นเบอร์โทรของลูกค้า',
    accountant: 'บัญชี รายงาน และการปิดยอดประจำวัน',
    content_editor: 'แก้ไขข้อความและรูปภาพบนเว็บไซต์เท่านั้น',
  },
}
