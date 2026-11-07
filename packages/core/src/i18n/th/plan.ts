// `plan` namespace (TH) — mirrors en/plan.ts exactly (keys + placeholders). Needs native review.
import type { Messages } from '../types'

export const plan: Messages['plan'] = {
  premiumBadge: 'Premium',
  upsell: {
    eyebrow: 'มีในแพ็กเกจ Premium',
    title: '{feature} อยู่ในแพ็กเกจ Premium',
    body: 'สปาของคุณใช้แพ็กเกจ Standard แพ็กเกจ Premium เพิ่ม {feature} แจ้งเราเพื่ออัปเกรด แล้วจะเปิดใช้งานได้ทันที ส่วนอื่นไม่เปลี่ยนแปลง',
    compare: 'เปรียบเทียบแพ็กเกจ',
    billing: 'การสมัครใช้งานของคุณ',
    contact: 'ติดต่อผู้ดูแลบัญชีของคุณเพื่ออัปเกรด',
  },
  feature: {
    ai: {
      name: 'AI และระบบอัตโนมัติ Instagram',
      text: 'พนักงานต้อนรับ AI กล่องข้อความ Instagram ที่ตอบกลับด้วย AI และรับจองจากแชท ข้อมูลเชิงลึกจาก AI และการสแกนใบเสร็จ',
    },
    marketing: {
      name: 'เครื่องมือการตลาด',
      text: 'แคมเปญพร้อมร่างข้อความชวนลูกค้ากลับมาและอวยพรวันเกิด ข้อเสนอช่วงเวลาว่าง การโพสต์บน Google Business และ Instagram การขอรีวิวและการตอบรีวิว',
    },
    multiBranch: {
      name: 'หลายสาขา',
      text: 'บริหารหลายสาขาจากแดชบอร์ดเดียว แต่ละสาขามีเวลาทำการ ห้อง พนักงาน และรายงานของตัวเอง',
    },
  },
  integrations:
    'การโพสต์และกล่องข้อความ Instagram รีวิวและโพสต์บน Google อยู่ในแพ็กเกจ Premium คุณยังเชื่อมต่อหรือยกเลิกการเชื่อมต่อบัญชีได้',
  branches: {
    limit: 'แพ็กเกจ Standard มีหนึ่งสาขา แพ็กเกจ Premium เพิ่มสาขาได้',
    extra: 'สาขาอื่นที่เปิดอยู่ยังใช้งานได้ตามปกติ การเพิ่มหรือกู้คืนสาขาต้องใช้แพ็กเกจ Premium',
  },
}
