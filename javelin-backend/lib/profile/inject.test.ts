import { describe, it, expect } from 'vitest';
import { injectProfile, PROFILE_INJECTION_PROMPT_RULES } from './inject';
import { PROFILE_SCHEMA_VERSION, type Profile, type Layer1, type Layer2 } from './types';

const BUILT_AT = '2026-04-23T12:00:00.000Z';

/** Helper builds a Profile with L1 envelope; overrides are flat L1 fields
 *  for ergonomic test sites. Pass `{}` for the empty-L1 case. */
function profile(layer1Overrides: Partial<Layer1> = {}): Profile {
  return {
    version: PROFILE_SCHEMA_VERSION,
    mode: 'live',
    layer1: {
      builtAt: BUILT_AT,
      ...layer1Overrides,
    },
  };
}

describe('injectProfile', () => {
  it('null profile returns empty string (cold window / build failure path)', () => {
    expect(injectProfile(null)).toBe('');
  });

  it('profile with only version/builtAt/mode (no facts) returns empty string', () => {
    // Per the "lines.length === 1" guard — header alone shouldn't be emitted.
    expect(injectProfile(profile())).toBe('');
  });

  it('emits header + business shape for subscription-only', () => {
    const out = injectProfile(profile({ business_shape: ['subscription'] }));
    expect(out).toContain('MERCHANT PROFILE');
    expect(out).toContain('subscription business');
    expect(out).not.toContain('one-time');
    expect(out).not.toContain('Connect');
  });

  it('formats hybrid (subscription + one_time) shape with " + " separator', () => {
    const out = injectProfile(
      profile({ business_shape: ['subscription', 'one_time'] })
    );
    expect(out).toContain('subscription + one-time payment business');
  });

  it('formats triple shape with comma + and separator', () => {
    const out = injectProfile(
      profile({ business_shape: ['subscription', 'one_time', 'connect'] })
    );
    expect(out).toContain('subscription, one-time payment, and Connect platform business');
  });

  describe('mrrBucket thresholds', () => {
    it('< 500 → early stage', () => {
      const out = injectProfile(
        profile({ scale: { mrr_amount: 250, mrr_currency: 'usd' } })
      );
      expect(out).toContain('early stage by MRR');
      expect(out).toContain('USD 250');
    });

    it('< 5000 → small', () => {
      const out = injectProfile(
        profile({ scale: { mrr_amount: 1500, mrr_currency: 'usd' } })
      );
      expect(out).toContain('small by MRR');
    });

    it('< 50000 → mid-sized', () => {
      const out = injectProfile(
        profile({ scale: { mrr_amount: 25000, mrr_currency: 'usd' } })
      );
      expect(out).toContain('mid-sized by MRR');
    });

    it('< 500000 → established', () => {
      const out = injectProfile(
        profile({ scale: { mrr_amount: 100000, mrr_currency: 'usd' } })
      );
      expect(out).toContain('established by MRR');
    });

    it('>= 500000 → large', () => {
      const out = injectProfile(
        profile({ scale: { mrr_amount: 1000000, mrr_currency: 'usd' } })
      );
      expect(out).toContain('large by MRR');
    });
  });

  it('renders integer amounts without decimal places, decimals with two', () => {
    const intOut = injectProfile(
      profile({ scale: { mrr_amount: 100, mrr_currency: 'usd' } })
    );
    expect(intOut).toContain('USD 100');
    expect(intOut).not.toContain('USD 100.00');

    const decOut = injectProfile(
      profile({ scale: { mrr_amount: 123.45, mrr_currency: 'usd' } })
    );
    expect(decOut).toContain('USD 123.45');
  });

  it('uppercases currency codes for display', () => {
    const out = injectProfile(
      profile({ scale: { mrr_amount: 500, mrr_currency: 'cad' } })
    );
    expect(out).toContain('CAD 500');
    expect(out).not.toContain('cad ');
  });

  it('catalog: lists plan names verbatim, in quotes', () => {
    const out = injectProfile(
      profile({
        catalog: [
          { name: 'Pro', monthly_amount: 50, currency: 'usd', active_count: 5 },
          { name: 'Basic', monthly_amount: 25, currency: 'usd', active_count: 10 },
        ],
      })
    );
    expect(out).toContain('"Pro"');
    expect(out).toContain('"Basic"');
    expect(out).toContain('refer to plans by these exact names');
  });

  it('mix rows: keys uppercased + percent share', () => {
    const out = injectProfile(
      profile({
        geography_mix: [
          { key: 'us', share: 0.75 },
          { key: 'ca', share: 0.25 },
        ],
      })
    );
    expect(out).toContain('US 75%, CA 25%');
  });

  it('first_charge_date emitted as ISO date when present', () => {
    const out = injectProfile(profile({ first_charge_date: '2025-01-01' }));
    expect(out).toContain('2025-01-01');
  });

  it('annual revenue is labeled as trailing 12-month INVOICED revenue with disambiguation', () => {
    // Item 23 P1 close-out: a generic "revenue" label confuses merchants whose
    // volume is mostly direct charges (invoiced revenue << gross volume).
    // Prose must explicitly call out: invoiced / subtotal / post-discount /
    // pre-tax / excludes direct charges.
    const out = injectProfile(
      profile({
        scale: {
          annual_revenue_amount: 125000,
          annual_revenue_currency: 'usd',
        },
      })
    );
    expect(out).toContain('USD 125,000');
    expect(out).toContain('trailing 12-month invoiced revenue');
    expect(out).toContain('subtotal');
    expect(out).toContain('post-discount');
    expect(out).toContain('pre-tax');
    expect(out).toContain('excludes direct charges');
  });

  it('omits sections whose fields are absent (P1-S8 Option A)', () => {
    const out = injectProfile(profile({ business_shape: ['subscription'] }));
    // No catalog, no scale, no mixes, no first charge.
    expect(out).not.toContain('Scale:');
    expect(out).not.toContain('Catalog');
    expect(out).not.toContain('Geography mix');
    expect(out).not.toContain('Payment method mix');
    expect(out).not.toContain('Currency mix');
    expect(out).not.toContain('First charge processed');
  });

  it('does NOT emit Stripe account age (dropped in v3 — unreliable inside Stripe Apps)', () => {
    // Regression guard: account_age_days was dropped because account.created
    // returned to a Stripe App reflects authorization timestamp, not actual
    // account creation. The injector must never speak about account age —
    // first_charge_date is the only honest age signal.
    const out = injectProfile(
      profile({
        business_shape: ['subscription'],
        first_charge_date: '2024-01-01',
        // Intentionally pass a stray account_age_days as `unknown` to confirm
        // even if a stale cache somehow ships this field, the injector
        // ignores it and never produces "account age" text.
        ...({ account_age_days: 9999 } as unknown as Partial<Profile>),
      })
    );
    expect(out).not.toContain('account age');
    expect(out).not.toContain('Stripe account age');
    expect(out).toContain('First charge processed: 2024-01-01');
  });

  // ── P1-S6: Cross-merchant isolation ───────────────────────────────────────
  // Critical correctness property: when we inject Merchant A's profile into a
  // prompt, NO fact from Merchant B (held separately in memory) leaks into the
  // assembled string. Profiles are per-request inputs; a regression that
  // accidentally referenced shared module state would surface here.

  it('cross-merchant isolation: only the passed profile appears in the output', () => {
    const merchantA: Profile = profile({
      business_shape: ['subscription'],
      catalog: [
        { name: 'Merchant A Pro', monthly_amount: 99, currency: 'usd', active_count: 12 },
      ],
      scale: {
        mrr_amount: 1188,
        mrr_currency: 'usd',
        customer_count: 12,
      },
      geography_mix: [{ key: 'us', share: 1 }],
      first_charge_date: '2025-01-01',
    });

    const merchantB: Profile = profile({
      business_shape: ['one_time', 'connect'],
      catalog: [
        { name: 'Acme Marketplace Tier', monthly_amount: 4999, currency: 'eur', active_count: 220 },
      ],
      scale: {
        mrr_amount: 1099780,
        mrr_currency: 'eur',
        customer_count: 9876,
        annual_revenue_amount: 14500000,
        annual_revenue_currency: 'eur',
      },
      geography_mix: [
        { key: 'de', share: 0.6 },
        { key: 'fr', share: 0.4 },
      ],
      payment_method_mix: [{ key: 'sepa_debit', share: 1 }],
      currency_mix: [{ key: 'eur', share: 1 }],
      first_charge_date: '2021-03-15',
    });

    const renderedA = injectProfile(merchantA);

    // Sanity: merchant A's facts ARE in their own injection.
    expect(renderedA).toContain('Merchant A Pro');
    expect(renderedA).toContain('USD 1,188');
    expect(renderedA).toContain('2025-01-01');

    // Critical: NOTHING from merchant B leaks in.
    const merchantBFacts = [
      'Acme Marketplace Tier',
      'EUR',
      'eur',
      'sepa_debit',
      'SEPA_DEBIT',
      'Connect',
      'one-time',
      'DE',
      'FR',
      '9,876',
      '14,500,000',
      '1,099,780',
      '2021-03-15',
    ];
    for (const fact of merchantBFacts) {
      expect(renderedA, `Merchant B fact "${fact}" leaked into Merchant A's injection`).not.toContain(fact);
    }

    // And conversely, Merchant B's render contains its own facts and not A's.
    const renderedB = injectProfile(merchantB);
    expect(renderedB).toContain('Acme Marketplace Tier');
    expect(renderedB).toContain('SEPA_DEBIT');
    expect(renderedB).not.toContain('Merchant A Pro');
    expect(renderedB).not.toContain('USD 1,188');
    expect(renderedB).not.toContain('2025-01-01');
  });

  it('cross-merchant isolation: repeated injections do not bleed state across calls', () => {
    // Even a stateless function can regress (e.g. memoization at the module
    // level). Render A, then B, then A again — A's two outputs must be byte
    // identical and B's facts must never appear in either A render.
    const merchantA: Profile = profile({
      business_shape: ['subscription'],
      catalog: [{ name: 'Alpha', monthly_amount: 10, currency: 'usd', active_count: 1 }],
    });
    const merchantB: Profile = profile({
      business_shape: ['connect'],
      catalog: [{ name: 'Beta', monthly_amount: 9999, currency: 'gbp', active_count: 500 }],
    });

    const a1 = injectProfile(merchantA);
    injectProfile(merchantB);
    const a2 = injectProfile(merchantA);

    expect(a1).toBe(a2);
    expect(a1).not.toContain('Beta');
    expect(a1).not.toContain('GBP');
    expect(a1).not.toContain('Connect');
  });
});

describe('PROFILE_INJECTION_PROMPT_RULES', () => {
  it('exists and forbids treating the profile as the source of any number', () => {
    expect(PROFILE_INJECTION_PROMPT_RULES).toContain('PROFILE USAGE');
    expect(PROFILE_INJECTION_PROMPT_RULES).toMatch(/never.*source of a number/i);
  });

  it('explicitly states the current request wins on conflict', () => {
    expect(PROFILE_INJECTION_PROMPT_RULES).toMatch(/current request wins/i);
  });

  it('mentions the seven-day staleness window', () => {
    expect(PROFILE_INJECTION_PROMPT_RULES).toMatch(/seven days|7 days/i);
  });

  it('teaches the interpreter the revenue vocabulary — invoiced vs gross volume', () => {
    // Item 23 P1 close-out: revenue terminology is a known confusion point.
    // The rules must arm the interpreter to proactively disambiguate.
    expect(PROFILE_INJECTION_PROMPT_RULES).toMatch(/revenue vocabulary/i);
    expect(PROFILE_INJECTION_PROMPT_RULES).toMatch(/invoiced revenue|billed revenue/i);
    expect(PROFILE_INJECTION_PROMPT_RULES).toMatch(/gross volume/i);
    // Must flag the direct-charges exclusion that drives the two figures apart.
    expect(PROFILE_INJECTION_PROMPT_RULES).toMatch(/direct charges?/i);
  });

  it('teaches distribution-aware normalcy framing for L2 pattern facts', () => {
    expect(PROFILE_INJECTION_PROMPT_RULES).toMatch(/distribution-aware|range.*not.*median|median.*range/i);
  });
});

// ── Layer 2 injection ───────────────────────────────────────────────────────

function profileWithL2(layer2: Partial<Layer2>): Profile {
  return {
    version: PROFILE_SCHEMA_VERSION,
    mode: 'live',
    layer1: { builtAt: BUILT_AT },
    layer2: { builtAt: BUILT_AT, ...layer2 },
  };
}

describe('injectProfile — Layer 2', () => {
  it('renders monthly_billed_revenue_series with currency and per-month entries', () => {
    const out = injectProfile(
      profileWithL2({
        monthly_billed_revenue_series: [
          { month: '2026-03', amount: 1234, currency: 'usd' },
          { month: '2026-04', amount: 1500, currency: 'usd' },
        ],
      }),
    );
    expect(out).toContain('Monthly billed revenue');
    expect(out).toContain('USD');
    expect(out).toContain('2026-03 1,234');
    expect(out).toContain('2026-04 1,500');
  });

  it('renders distribution fields with typical/range/n_months phrasing', () => {
    const out = injectProfile(
      profileWithL2({
        churn_distribution: { min: 0, median: 2, max: 5, n_months: 6 },
      }),
    );
    expect(out).toContain('Monthly subscription cancellations');
    expect(out).toContain('typically 2');
    expect(out).toContain('range 0–5');
    expect(out).toContain('last 6 months');
  });

  it('renders top_customer_concentration with all three shares as percentages', () => {
    const out = injectProfile(
      profileWithL2({
        top_customer_concentration: {
          top_1_share: 0.23,
          top_5_share: 0.67,
          top_10_share: 0.89,
          currency: 'usd',
        },
      }),
    );
    expect(out).toContain('Customer concentration');
    expect(out).toContain('USD');
    expect(out).toContain('top customer 23%');
    expect(out).toContain('top 5 67%');
    expect(out).toContain('top 10 89%');
  });
});
