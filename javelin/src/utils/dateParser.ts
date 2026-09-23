export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Parses natural language date expressions from a user's question.
 * Supported: "last N days", "last month", "last quarter", "last year",
 * "this year", "ytd", "next month", "next quarter", "Q1–Q4 [YYYY]",
 * "January 2025", "Jan 2025".
 * Default when no pattern matches: last 30 days.
 */
export function parseDateRange(query: string): DateRange {
  const now = new Date();
  const q = query.toLowerCase();

  const lastNDays = q.match(/last\s+(\d+)\s+days?/);
  if (lastNDays) {
    const start = new Date(now);
    start.setDate(start.getDate() - parseInt(lastNDays[1], 10));
    return { start, end: new Date(now) };
  }

  if (q.includes('last month')) {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59),
    };
  }

  if (q.includes('last quarter')) {
    const cq = Math.floor(now.getMonth() / 3);
    return {
      start: new Date(now.getFullYear(), (cq - 1) * 3, 1),
      end: new Date(now.getFullYear(), cq * 3, 0, 23, 59, 59),
    };
  }

  if (q.includes('last year')) {
    return {
      start: new Date(now.getFullYear() - 1, 0, 1),
      end: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59),
    };
  }

  if (q.includes('this year') || q.includes('this calendar year') || q.includes('ytd')) {
    return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now) };
  }

  // "from <month> <day> <year> until/to today" or similar explicit start-to-now ranges
  const fromUntilMatch = q.match(/from\s+(\w+)\s+(\d{1,2})[\s,]+(\d{4})\s+(?:until|to)\s+(?:today|now)/);
  if (fromUntilMatch) {
    const monthNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const mi = monthNames.findIndex((m) => fromUntilMatch[1].toLowerCase().startsWith(m));
    if (mi !== -1) {
      return {
        start: new Date(parseInt(fromUntilMatch[3], 10), mi, parseInt(fromUntilMatch[2], 10)),
        end: new Date(now),
      };
    }
  }

  if (q.includes('next month')) {
    return {
      start: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      end: new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59),
    };
  }

  if (q.includes('next quarter')) {
    const cq = Math.floor(now.getMonth() / 3);
    return {
      start: new Date(now.getFullYear(), (cq + 1) * 3, 1),
      end: new Date(now.getFullYear(), (cq + 2) * 3, 0, 23, 59, 59),
    };
  }

  const quarterMatch = q.match(/q([1-4])(?:\s*(\d{4}))?/);
  if (quarterMatch) {
    const qi = parseInt(quarterMatch[1], 10) - 1;
    const yr = quarterMatch[2] ? parseInt(quarterMatch[2], 10) : now.getFullYear();
    return {
      start: new Date(yr, qi * 3, 1),
      end: new Date(yr, (qi + 1) * 3, 0, 23, 59, 59),
    };
  }

  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const short  = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  for (let i = 0; i < 12; i++) {
    const m = q.match(new RegExp(`(${months[i]}|${short[i]})\\s+(\\d{4})`));
    if (m) {
      const yr = parseInt(m[2], 10);
      return {
        start: new Date(yr, i, 1),
        end: new Date(yr, i + 1, 0, 23, 59, 59),
      };
    }
  }

  // Default: last 30 days
  const start = new Date(now);
  start.setDate(start.getDate() - 30);
  return { start, end: new Date(now) };
}

/** Converts a Date to a Unix timestamp in seconds. */
export function toUnix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
