import type { Messages } from '../types'

export const validation: Messages['validation'] = {
  required: 'โปรดกรอกข้อมูลในช่องนี้',
  tooShort: { other: 'ใช้อย่างน้อย {count} ตัวอักษร' },
  tooLong: { other: 'ใช้ได้ไม่เกิน {count} ตัวอักษร' },
  email: 'โปรดกรอกอีเมลให้ถูกต้อง',
  number: 'โปรดกรอกตัวเลข',
  uaeMobile: 'โปรดกรอกเบอร์มือถือ UAE เช่น 050 123 4567',
  clientPhoneHint: 'UAE: 05X XXX XXXX · ประเทศอื่น: ใส่ + ตามด้วยรหัสประเทศ เช่น +44 7700 900123',
}
