import { tool } from 'ai';
import { z } from 'zod';
import {
  comparePeriods,
  type CompareableMetric,
} from '../../metrics/comparePeriods';
import { periodCollectedRevenue } from '../../metrics/periodCollectedRevenue';
import { periodBilledRevenue } from '../../metrics/periodBilledRevenue';
import { periodNetCash } from '../../metrics/periodNetCash';
import { periodNetRevenue } from '../../metrics/periodNetRevenue';
import { churnCount } from '../../metrics/churnCount';
import { payingCustomerCount } from '../../metrics/payingCustomerCount';
import type { StripeChargeLike } from '../../metrics/chargeEnriched';
import type { StripeInvoiceLike } from '../../metrics/invoiceEnriched';
import type { StripeSubscriptionLike } from '../../metrics/subscriptionEnriched';
import type { Period } from '../../metrics/types';
import type Stripe from 'stripe';
import {
  fetchCharges,
  fetchBalanceTransactions,
  fetchInvoices,
  fetchDisputes,
  fetchCanceledSubscriptions,
  fetchAccountDefaultCurrency,
} from '../fetchers';
import { getStripeClient } from '../stripeClient';

const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be ISO date YYYY-MM-DD`)
    .refine(
      (s) => !Number.isNaN(new Date(s + 'T00:00:00Z').getTime()),
      `${label} must be a valid calendar date`,
    );

const periodSchema = z
  .object({
    start: isoDate('start'),
    end: isoDate('end'),
  })
  .strict();

const compareableMetric = z.enum([
  'period_collected_revenue',
  'period_billed_revenue',
  'period_net_cash',
  'period_net_revenue',
  'churn_count',
  'paying_customer_count',
]);

export const COMPARE_PERIODS_INPUT_SCHEMA = z
  .object({
    metric: compareableMetric.describe(
      'Which scalar metric to compare. Must be one of the supported metrics.',
    ),
    period_a: periodSchema.describe(
      'First period (typically the baseline / earlier period)',
    ),
    period_b: periodSchema.describe(
      'Second period (typically the more recent / comparison period)',
    ),
  })
  .strict();

function isoToPeriod(start: string, end: string): Period {
  return {
    start: Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000),
    end: Math.floor(new Date(end + 'T23:59:59Z').getTime() / 1000),
  };
}

interface ScalarFetch {
  value: number;
  unit: 'usd' | 'count';
  currency?: string;
}

async function computeMetricValue(
  metric: CompareableMetric,
  period: Period,
  stripe: Stripe,
  accountId: string,
  now: Date,
  defaultCurrency: string,
): Promise<ScalarFetch> {
  switch (metric) {
    case 'period_collected_revenue': {
      const [charges, btxs] = await Promise.all([
        fetchCharges(stripe, accountId, period),
        fetchBalanceTransactions(stripe, accountId, period),
      ]);
      const result = periodCollectedRevenue({
        charges: charges as unknown as StripeChargeLike[],
        balanceTransactions: btxs as unknown as Parameters<
          typeof periodCollectedRevenue
        >[0]['balanceTransactions'],
        period,
        now,
      });
      const row =
        result.rows.find((r) => r.currency === defaultCurrency) ??
        result.rows[0];
      return {
        value: row?.collected_revenue ?? 0,
        unit: 'usd',
        currency: defaultCurrency,
      };
    }
    case 'period_billed_revenue': {
      const invoices = await fetchInvoices(stripe, accountId, period);
      const result = periodBilledRevenue({
        invoices: invoices as unknown as StripeInvoiceLike[],
        period,
        now,
      });
      const row =
        result.rows.find((r) => r.currency === defaultCurrency) ??
        result.rows[0];
      return {
        value: row?.billed_revenue ?? 0,
        unit: 'usd',
        currency: defaultCurrency,
      };
    }
    case 'period_net_cash': {
      const btxs = await fetchBalanceTransactions(stripe, accountId, period);
      const result = periodNetCash({
        balanceTransactions: btxs as unknown as Parameters<
          typeof periodNetCash
        >[0]['balanceTransactions'],
        period,
        now,
      });
      const row =
        result.rows.find((r) => r.currency === defaultCurrency) ??
        result.rows[0];
      return {
        value: row?.net_cash ?? 0,
        unit: 'usd',
        currency: defaultCurrency,
      };
    }
    case 'period_net_revenue': {
      const [charges, btxs, disputes] = await Promise.all([
        fetchCharges(stripe, accountId, period),
        fetchBalanceTransactions(stripe, accountId, period),
        fetchDisputes(stripe, accountId, period),
      ]);
      const result = periodNetRevenue({
        charges: charges as unknown as StripeChargeLike[],
        balanceTransactions: btxs as unknown as Parameters<
          typeof periodNetRevenue
        >[0]['balanceTransactions'],
        disputes: disputes as unknown as Parameters<
          typeof periodNetRevenue
        >[0]['disputes'],
        period,
        now,
      });
      const row =
        result.rows.find((r) => r.currency === defaultCurrency) ??
        result.rows[0];
      return {
        value: row?.net_revenue ?? 0,
        unit: 'usd',
        currency: defaultCurrency,
      };
    }
    case 'churn_count': {
      const subs = await fetchCanceledSubscriptions(stripe, accountId, period);
      const result = churnCount({
        subscriptions: subs as unknown as StripeSubscriptionLike[],
        period,
        now,
      });
      return { value: result.value.total, unit: 'count' };
    }
    case 'paying_customer_count': {
      const charges = await fetchCharges(stripe, accountId, period);
      const result = payingCustomerCount({
        charges: charges as unknown as StripeChargeLike[],
        period,
        now,
      });
      return { value: result.value, unit: 'count' };
    }
  }
}

export function buildComparePeriodsTool(accountId: string) {
  return tool({
    description:
      "Compare a single scalar metric between two date periods. Use for 'compare X to Y', 'how does last month compare to the month before', 'did churn go up or down between Q1 and Q4 2025'. Inputs: metric (one of: period_collected_revenue, period_billed_revenue, period_net_cash, period_net_revenue, churn_count, paying_customer_count) + period_a (baseline/earlier) + period_b (comparison/later), each with start/end ISO. Returns both values, absolute delta, percent delta, direction ('up'/'down'/'flat'). NOT for MRR/active_subscription_count (snapshots, not periods) or churn_rate (fixed window). Multi-currency merchants: uses account default currency only. Don't also call the underlying metric tool for either period — compare_periods returns both values.",
    inputSchema: COMPARE_PERIODS_INPUT_SCHEMA,
    execute: async ({ metric, period_a, period_b }) => {
      try {
        const stripe = getStripeClient();
        const now = new Date();
        const periodA = isoToPeriod(period_a.start, period_a.end);
        const periodB = isoToPeriod(period_b.start, period_b.end);
        // Fetch default currency once; both period computations reuse it.
        const defaultCurrency = await fetchAccountDefaultCurrency(
          stripe,
          accountId,
        );
        const [a, b] = await Promise.all([
          computeMetricValue(
            metric as CompareableMetric,
            periodA,
            stripe,
            accountId,
            now,
            defaultCurrency,
          ),
          computeMetricValue(
            metric as CompareableMetric,
            periodB,
            stripe,
            accountId,
            now,
            defaultCurrency,
          ),
        ]);
        return comparePeriods({
          metric: metric as CompareableMetric,
          a: { value: a.value, period: periodA },
          b: { value: b.value, period: periodB },
          unit: a.unit,
          currency: a.currency,
          now,
        });
      } catch (err) {
        console.error('[ask] compare_periods tool execute() failed:', err);
        throw err;
      }
    },
  });
}
