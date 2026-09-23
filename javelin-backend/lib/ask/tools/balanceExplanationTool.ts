import { tool } from 'ai';
import { z } from 'zod';
import { balanceExplanation } from '../../metrics/balanceExplanation';
import { toMajor } from '../../metrics/types';
import {
  fetchBalance,
  fetchBalanceTransactionsForExplanation,
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

export const BALANCE_EXPLANATION_INPUT_SCHEMA = z
  .object({
    start: isoDate('start').describe('Period start date, ISO format YYYY-MM-DD'),
    end: isoDate('end').describe(
      'Period end date, ISO format YYYY-MM-DD (inclusive)',
    ),
  })
  .strict();

export function buildBalanceExplanationTool(accountId: string) {
  return tool({
    description:
      "Explains how the balance MOVED over a window (Stripe's Balance Summary). Per-currency: starting balance, activity by category (charges/refunds/disputes/fees/adjustments), payouts separately, ending balance. Use for 'why is my balance X', 'how did my balance change', 'how much in Stripe fees'. NOT for snapshot questions (use account_balance). Inputs: start/end ISO. Self-contained — don't also call period_collected_revenue or period_net_cash for the same window; the balance answer already includes those streams.",
    inputSchema: BALANCE_EXPLANATION_INPUT_SCHEMA,
    execute: async ({ start, end }) => {
      try {
        const stripe = getStripeClient();
        const period = {
          start: Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000),
          end: Math.floor(new Date(end + 'T23:59:59Z').getTime() / 1000),
        };

        // Q-B / Option B2: derive starting balance per-currency by synthesis:
        //   starting = current_balance − net_in_period_activity + payouts_outflow_in_period
        // current_balance = balance.available + balance.pending (in major units, per currency).
        const [balance, { transactions, truncated }] = await Promise.all([
          fetchBalance(stripe, accountId),
          fetchBalanceTransactionsForExplanation(stripe, accountId, period),
        ]);

        const currentMajorByCurrency: Record<string, number> = {};
        const addSurface = (
          rows: Array<{ amount: number; currency: string }> | null | undefined,
        ) => {
          if (!rows) return;
          for (const row of rows) {
            const c = row.currency.toLowerCase();
            currentMajorByCurrency[c] =
              (currentMajorByCurrency[c] ?? 0) + toMajor(row.amount, c);
          }
        };
        addSurface(balance.available);
        addSurface(balance.pending);

        // In-period net activity by currency, plus payouts by currency.
        const netActivityMinor: Record<string, number> = {};
        const payoutOutflowMinor: Record<string, number> = {};
        for (const txn of transactions) {
          if (txn.created < period.start || txn.created > period.end) continue;
          const c = txn.currency.toLowerCase();
          if (txn.reporting_category === 'payout') {
            payoutOutflowMinor[c] = (payoutOutflowMinor[c] ?? 0) + Math.abs(txn.net);
          } else {
            netActivityMinor[c] = (netActivityMinor[c] ?? 0) + txn.net;
          }
        }

        const startingBalanceByCurrency: Record<string, number> = {};
        const allCurrencies = new Set<string>([
          ...Object.keys(currentMajorByCurrency),
          ...Object.keys(netActivityMinor),
          ...Object.keys(payoutOutflowMinor),
        ]);
        for (const c of allCurrencies) {
          const current = currentMajorByCurrency[c] ?? 0;
          const net = toMajor(netActivityMinor[c] ?? 0, c);
          const payout = toMajor(payoutOutflowMinor[c] ?? 0, c);
          // current = starting + net − payout  →  starting = current − net + payout
          startingBalanceByCurrency[c] = current - net + payout;
        }

        return balanceExplanation({
          transactions,
          startingBalanceByCurrency,
          period,
          now: new Date(),
          truncated,
        });
      } catch (err) {
        console.error('[ask] balance_explanation tool execute() failed:', err);
        throw err;
      }
    },
  });
}
