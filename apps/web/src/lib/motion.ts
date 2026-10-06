/** Motion tokens — docs/PLAN.md §12.3. */
export const ease = [0.2, 0, 0, 1] as const
export const duration = { fast: 0.12, base: 0.2, layout: 0.28 } as const
export const spring = { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 } as const
