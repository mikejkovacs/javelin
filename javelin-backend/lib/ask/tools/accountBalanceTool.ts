import { tool } from 'ai';
import { z } from 'zod';
import { accountBalance } from '../../metrics/accountBalance';
import { fetchBalance, fetchPendingBalanceTransactions } from '../fetchers';
import { getStripeClient } from '../stripeClient';

export const ACCOUNT_BALANCE_INPUT_SCHEMA = z.object({}).strict();

export function buildAccountBalanceTool(accountId: string) {
  return tool({
    description:
      "Snapshot of CURRENT Stripe balance — `available` (payable to bank now), `pending` (settling), `instant_available` when applicable. Multi-currency: one row per currency, never summed. Non-zero pending returns `pending_settlement_breakdown` (per-date when funds settle). Use for 'what's in my Stripe account', 'when does pending settle'. NOT for balance-change-over-time (use `balance_explanation`). No inputs.",
    inputSchema: ACCOUNT_BALANCE_INPUT_SCHEMA,
    execute: async () => {
      try {
        const stripe = getStripeClient();
        const [balance, pendingTransactions] = await Promise.all([
          fetchBalance(stripe, accountId),
          fetchPendingBalanceTransactions(stripe, accountId),
        ]);
        return accountBalance({
          balance,
          pendingTransactions,
          now: new Date(),
        });
      } catch (err) {
        console.error('[ask] account_balance tool execute() failed:', err);
        throw err;
      }
    },
  });
}
