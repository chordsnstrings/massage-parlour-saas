export const validation = {
  required: 'This field is required',
  tooShort: { one: 'Use at least {count} character', other: 'Use at least {count} characters' },
  tooLong: { one: 'Use at most {count} character', other: 'Use at most {count} characters' },
  email: 'Enter a valid email',
  number: 'Enter a number',
  uaeMobile: 'Enter a UAE mobile, e.g. 050 123 4567',
  /** Client (customer) phones, R38: UAE mobile or any number with + and its country code. */
  clientPhoneHint: 'UAE: 05X XXX XXXX · other countries: + and the country code, e.g. +44 7700 900123',
} as const
