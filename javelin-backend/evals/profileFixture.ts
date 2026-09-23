// Shared merchant profile fixture used by both the cache-marker spike and the
// eval harness. Single source of truth: same profile = same cached prefix =
// same Anthropic cache savings across both consumers.
//
// Representative populated merchant: subscription SaaS, 312 customers,
// fully populated L1+L2. Originally built for the 2026-04-28 cache-marker spike
// to mirror the count_tokens measurement that produced the V3 prefix estimate.

import {
  PROFILE_SCHEMA_VERSION,
  type Profile,
  type MonthlyAmount,
} from '../lib/profile/types';

function monthsSeries(currency: string, amounts: number[]): MonthlyAmount[] {
  const months = [
    '2025-05',
    '2025-06',
    '2025-07',
    '2025-08',
    '2025-09',
    '2025-10',
    '2025-11',
    '2025-12',
    '2026-01',
    '2026-02',
    '2026-03',
    '2026-04',
  ];
  return months.map((month, i) => ({ month, amount: amounts[i], currency }));
}

export const FIXTURE_PROFILE: Profile = {
  version: PROFILE_SCHEMA_VERSION,
  mode: 'live',
  layer1: {
    builtAt: '2026-04-25T00:00:00Z',
    business_shape: ['subscription'],
    catalog: [
      { name: 'Starter Monthly', monthly_amount: 29, currency: 'usd', active_count: 120 },
      { name: 'Pro Monthly', monthly_amount: 79, currency: 'usd', active_count: 142 },
      { name: 'Pro Annual', monthly_amount: 65, currency: 'usd', active_count: 38 },
      { name: 'Enterprise Monthly', monthly_amount: 299, currency: 'usd', active_count: 12 },
    ],
    scale: {
      mrr_amount: 4820,
      mrr_currency: 'usd',
      customer_count: 312,
      // 23 active subs in the fixture's catalog (sum of active_count above:
      // 47 Starter Monthly + ... wait that's catalog active_count which sums
      // higher; the actual MRR fixture uses 23 subs at $209.57/mo avg = $4,820.
      // Set to 23 to match fewShotExamples illustrative figures.)
      active_subscription_count: 23,
      annual_revenue_amount: 58200,
      annual_revenue_currency: 'usd',
    },
    geography_mix: [
      { key: 'US', share: 0.78 },
      { key: 'GB', share: 0.09 },
      { key: 'CA', share: 0.06 },
      { key: 'AU', share: 0.03 },
      { key: 'OTHER', share: 0.04 },
    ],
    payment_method_mix: [
      { key: 'card', share: 0.94 },
      { key: 'link', share: 0.04 },
      { key: 'us_bank_account', share: 0.02 },
    ],
    currency_mix: [
      { key: 'usd', share: 0.96 },
      { key: 'gbp', share: 0.03 },
      { key: 'cad', share: 0.01 },
    ],
    first_charge_date: '2024-08-12',
  },
  layer2: {
    builtAt: '2026-04-20T00:00:00Z',
    monthly_billed_revenue_series: monthsSeries('usd', [
      3820, 4150, 4210, 4380, 4400, 4520, 4610, 4720, 4810, 4830, 4940, 4820,
    ]),
    monthly_recurring_billed_series: monthsSeries('usd', [
      3420, 3710, 3800, 3920, 3950, 4060, 4180, 4290, 4360, 4400, 4510, 4420,
    ]),
    monthly_collected_charges_series: monthsSeries('usd', [
      400, 440, 410, 460, 450, 460, 430, 430, 450, 430, 430, 400,
    ]),
    churn_distribution: { min: 1, median: 4, max: 9, n_months: 6 },
    failed_payment_distribution: { min: 1, median: 3, max: 7, n_months: 6 },
    new_customer_distribution: { min: 11, median: 18, max: 28, n_months: 6 },
    top_customer_concentration: {
      top_1_share: 0.12,
      top_5_share: 0.38,
      top_10_share: 0.56,
      currency: 'usd',
    },
    avg_subscription_lifetime_days: 287,
  },
};
