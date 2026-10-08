import type { Messages } from '../types'

export const shell: Messages['shell'] = {
  mainMenu: 'เมนูหลัก',
  sectionPages: 'หน้าในส่วนนี้',
  openMenu: 'เปิดเมนู',
  closeMenu: 'ปิดเมนู',
  language: 'ภาษา',
  account: 'บัญชีผู้ใช้และความปลอดภัย',
  switchSpa: 'เปลี่ยนสปา',
  signOut: 'ออกจากระบบ',
  profileMenu: 'เมนูโปรไฟล์ของ {name}',
  profileRole: '{role} · {spa}',
  superAdmin: 'ผู้ดูแลแพลตฟอร์ม',
  logoAlt: 'โลโก้ {spa}',
  greeting: {
    morning: 'สวัสดีตอนเช้า {name}',
    afternoon: 'สวัสดีตอนบ่าย {name}',
    evening: 'สวัสดีตอนเย็น {name}',
  },
  plan: {
    aiAllowance: 'โควตา AI · ใช้ไปแล้ว {percent} ในเดือนนี้',
    aiPaused: 'ใช้โควตา AI ครบแล้ว · AI จะหยุดทำงานจนถึงเดือนหน้า',
    renews: 'ต่ออายุ {date} · {price}/{interval}',
    trialEnds: 'ทดลองใช้ถึง {date}',
    interval: { year: 'ปี', month: 'เดือน' },
  },
  banner: {
    impersonating: 'กำลังดูในฐานะผู้ดูแลแพลตฟอร์ม — ทุกการเปลี่ยนแปลงจะถูกบันทึกไว้ในบันทึกการตรวจสอบ',
    readOnly: 'บัญชีนี้อยู่ในโหมดอ่านอย่างเดียว โปรดติดต่อฝ่ายสนับสนุนเพื่อกลับมาใช้งานได้เต็มรูปแบบ',
  },
}
