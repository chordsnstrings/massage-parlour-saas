import type { IntakeField } from '@spa/db'

/** Masks a UAE E.164 number for members without `clients.phone`: 971501234567 → +971 50 ••• ••67. */
export const maskClientPhone = (e164: string) =>
  e164.length >= 8 ? `+${e164.slice(0, 3)} ${e164.slice(3, 5)} ••• ••${e164.slice(-2)}` : '•••'

/** Stored as these English values; shown via `clients.prefs.pressureOption.*`. */
export const PRESSURE_OPTIONS = ['Light', 'Medium', 'Firm', 'Deep'] as const

/** Comma/newline separated tags → unique, trimmed, lower-case list. */
export const parseTags = (raw: string | undefined) =>
  [
    ...new Set(
      (raw ?? '')
        .split(/[,\n]/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 20)

/** Signature pads draw into this coordinate space so every capture renders the same. */
export const SIGNATURE_VIEWBOX = { w: 600, h: 200 } as const

/** Accepts only the M/L path data the signature pad produces. */
export const isSignaturePath = (d: string) => /^M[\d.\s MLml-]+$/.test(d) && /L/.test(d) && d.length <= 60_000

export type IntakeTemplateInput = {
  name: string
  fields: IntakeField[]
  waiver: { en: string; ar?: string }
}

/** A sensible UAE massage intake: health screening, preferences and a bilingual waiver. */
export const RECOMMENDED_INTAKE: IntakeTemplateInput = {
  name: 'Massage intake & consent',
  fields: [
    {
      key: 'pregnant',
      label: { en: 'Are you pregnant or could you be pregnant?', ar: 'هل أنتِ حامل أو قد تكونين حاملاً؟' },
      type: 'yesno',
      required: true,
    },
    {
      key: 'recent_surgery',
      label: {
        en: 'Have you had surgery or an injury in the last 6 months?',
        ar: 'هل أجريت عملية جراحية أو تعرضت لإصابة خلال الأشهر الستة الماضية؟',
      },
      type: 'yesno',
      required: true,
    },
    {
      key: 'surgery_details',
      label: { en: 'If yes, please give details', ar: 'إذا كانت الإجابة نعم، يرجى ذكر التفاصيل' },
      type: 'textarea',
    },
    {
      key: 'high_blood_pressure',
      label: {
        en: 'Do you have high blood pressure or a heart condition?',
        ar: 'هل تعاني من ارتفاع ضغط الدم أو من مرض في القلب؟',
      },
      type: 'yesno',
      required: true,
    },
    {
      key: 'skin_conditions',
      label: {
        en: 'Do you have any skin conditions, rashes or open wounds?',
        ar: 'هل لديك أي أمراض جلدية أو طفح جلدي أو جروح مفتوحة؟',
      },
      type: 'yesno',
      required: true,
    },
    {
      key: 'allergies',
      label: {
        en: 'Allergies (oils, nuts, fragrances, latex…)',
        ar: 'الحساسية (الزيوت، المكسرات، العطور، اللاتكس…)',
      },
      type: 'text',
    },
    {
      key: 'areas_to_avoid',
      label: { en: 'Areas to avoid', ar: 'مناطق يجب تجنبها' },
      type: 'text',
    },
    {
      key: 'pressure',
      label: { en: 'Preferred pressure', ar: 'الضغط المفضل' },
      type: 'select',
      options: ['Light', 'Medium', 'Firm', 'Deep'],
      required: true,
    },
  ],
  waiver: {
    en: 'I confirm that the information I have given is complete and accurate, and I will tell my therapist about any change to my health. I understand that massage is not a substitute for medical care. I accept the treatment and the spa’s terms, and I agree to let my therapist know straight away if I feel any discomfort.',
    ar: 'أؤكد أن المعلومات التي قدمتها كاملة وصحيحة، وسأبلغ المعالج بأي تغيير في حالتي الصحية. أدرك أن المساج ليس بديلاً عن الرعاية الطبية. أوافق على العلاج وعلى شروط المركز، وأتعهد بإبلاغ المعالج فوراً إذا شعرت بأي انزعاج.',
  },
}
