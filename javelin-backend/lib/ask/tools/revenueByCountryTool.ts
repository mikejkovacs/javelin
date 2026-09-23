import { tool } from 'ai';
import { z } from 'zod';
import { revenueByCountry } from '../../metrics/revenueByCountry';
import type { StripeChargeLike } from '../../metrics/chargeEnriched';
import { MAX_BUCKETS, bucketCount } from '../../metrics/bucketing';
import { fetchCharges } from '../fetchers';
import { getStripeClient } from '../stripeClient';

const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be ISO date YYYY-MM-DD`)
    .refine(
      (s) => !Number.isNaN(new Date(s + 'T00:00:00Z').getTime()),
      `${label} must be a valid calendar date`,
    );

export const REVENUE_BY_COUNTRY_INPUT_SCHEMA = z
  .object({
    start: isoDate('start').describe('Period start date, ISO format YYYY-MM-DD'),
    end: isoDate('end').describe(
      'Period end date, ISO format YYYY-MM-DD (inclusive)',
    ),
    granularity: z
      .enum(['day', 'week', 'month'])
      .optional()
      .describe(
        "Optional time-series granularity. Omit for a single period total (existing behavior). Set to 'day', 'week', or 'month' to return a per-(country, currency) time series with dense zero-fill. Caps: day max 90 days, week max 52 weeks, month max 36 months — exceeding throws an error and the tool description teaches falling back to a coarser granularity.",
      ),
  })
  .strict();

export function buildRevenueByCountryTool(accountId: string) {
  return tool({
    description:
      'Breaks period COLLECTED revenue (charges only) by country. Country = card-issuing country (BIN-derived) — this is a PROXY for buyer location: a customer paying with a foreign-issued card appears under the issuing country, not their physical location. When narrating answers, briefly disclose this attribution if the answer hinges on country mix (e.g., "country here is the card-issuing country, derived from the BIN"). Use for "revenue by country", "where are my customers". Multi-currency: rows carry their own currency; charges in different currencies are NOT summed (no FX). Returns rows sorted by currency volume then amount; no-country charges bucket as "unknown". When `granularity` is set (\'day\'|\'week\'|\'month\'), returns a per-(country, currency) time series with dense zero-fill — use for "country trend over time", "is country X growing". Granularity caps: day 90 days, week 52 weeks, month 36 months — for longer ranges fall back to coarser granularity. Inputs: start/end ISO; optional granularity.',
    inputSchema: REVENUE_BY_COUNTRY_INPUT_SCHEMA,
    execute: async ({ start, end, granularity }) => {
      try {
        const stripe = getStripeClient();
        const period = {
          start: Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000),
          end: Math.floor(new Date(end + 'T23:59:59Z').getTime() / 1000),
        };
        if (granularity) {
          const count = bucketCount(period, granularity);
          const max = MAX_BUCKETS[granularity];
          if (count > max) {
            throw new Error(
              `revenue_by_country: ${granularity} granularity supports a max of ${max} buckets; given range produces ${count}. Use a coarser granularity (e.g., week or month) for longer ranges.`,
            );
          }
        }
        const charges = await fetchCharges(stripe, accountId, period);
        const baseInput = {
          charges: charges as unknown as StripeChargeLike[],
          period,
          now: new Date(),
        };
        return granularity
          ? revenueByCountry({ ...baseInput, granularity })
          : revenueByCountry(baseInput);
      } catch (err) {
        console.error('[ask] revenue_by_country tool execute() failed:', err);
        throw err;
      }
    },
  });
}
