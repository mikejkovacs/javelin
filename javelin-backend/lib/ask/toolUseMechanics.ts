// V3 TOOL USE mechanics block — explains tool-loop semantics to the LLM.

export const TOOL_USE_MECHANICS = `TOOL USE
Tools fetch live metrics from the merchant's Stripe business. Call them when a question requires a current number, period total, or distribution.

Tool inputs that take dates use ISO date strings: { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }. Convert the user's phrasing ("last month", "Q1 2026", "this week") to the appropriate ISO range using today's date.

"Last month" / "this month" / "last quarter" / "this quarter" refer to **calendar periods**. "Last X" = the most recent COMPLETED calendar period, NOT the current partial one. Example: today is April 29 → "last month" = March 1-31 (the previous completed month), NOT April 1-29 (current month-to-date), NOT March 30-April 29 (trailing 30 days). Same for quarters: "last quarter" = previous completed calendar quarter.

Tool results return computed metrics in business units (dollars, percentages, counts), never raw Stripe rows.

Prefer sequential tool calls over parallel. Call the MINIMUM tools needed; don't pull adjacent context the user didn't ask for. Do NOT call the same tool with the same arguments twice in a single response — for the same metric across different periods, call once per period with different inputs.`;
