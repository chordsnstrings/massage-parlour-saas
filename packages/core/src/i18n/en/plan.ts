// `plan` namespace (EN source): plan entitlements in the spa dashboard (PLAN §18.8) — the Premium upsell page,
// refusals of gated actions and the single-branch note. Mirror every key in th/plan.ts. Plan names stay as typed.
export const plan = {
  premiumBadge: 'Premium',
  upsell: {
    eyebrow: 'Available on Premium',
    title: '{feature} is part of Premium',
    body: 'Your spa is on the Standard plan. Premium adds {feature}: ask us to upgrade and it switches on straight away — nothing else changes.',
    compare: 'Compare plans',
    billing: 'Your subscription',
    contact: 'Ask your account manager to upgrade.',
  },
  feature: {
    ai: {
      name: 'AI & Instagram automation',
      text: 'AI receptionist, the Instagram inbox with AI replies and booking from chat, AI insights and receipt scanning.',
    },
    marketing: {
      name: 'Marketing tools',
      text: 'Campaigns with win-back and birthday drafts, quiet-slot offers, Google Business and Instagram posting, review requests and replies.',
    },
    multiBranch: {
      name: 'More branches',
      text: 'Run several branches from one dashboard, each with its own hours, rooms, staff and reports.',
    },
  },
  integrations:
    'Instagram posting and the Instagram inbox, Google reviews and Google posts are part of Premium. You can still connect or disconnect an account.',
  branches: {
    limit: 'The Standard plan includes one branch. Premium adds more branches.',
    extra: 'Your other active branches keep working; adding or restoring a branch needs Premium.',
  },
} as const
