import { estimateCostUsd } from "@/lib/ai/pricing";
import type { AdminUsageGroupedRow } from "@/types/database";

export type UsageCategory = "image_analysis" | "blog_generation" | "partial_regeneration" | "text_generation";

export function categorize(row: Pick<AdminUsageGroupedRow, "feature" | "operation">): UsageCategory {
  if (row.feature === "VISION_ANALYSIS") return "image_analysis";
  if (row.operation === "BLOG_WRITE") return "blog_generation";
  if (row.operation === "PARAGRAPH_REGENERATE") return "partial_regeneration";
  return "text_generation";
}

export type RowCost = { costUsd: number; verified: boolean };

function rowCost(row: AdminUsageGroupedRow): RowCost {
  const est = estimateCostUsd(row.provider, row.model, row.input_tokens, row.output_tokens);
  return est ?? { costUsd: 0, verified: false };
}

export type Totals = {
  callCount: number;
  successCount: number;
  failCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  // Sum of ai_usage_logs.credits_used. Rows from before STEP24 have this
  // null (never backfilled), so they simply contribute 0 here — not double
  // counted, not retroactively estimated.
  creditsUsed: number;
  allVerified: boolean;
};

function emptyTotals(): Totals {
  return {
    callCount: 0,
    successCount: 0,
    failCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    creditsUsed: 0,
    allVerified: true,
  };
}

function addRow(totals: Totals, row: AdminUsageGroupedRow) {
  const { costUsd, verified } = rowCost(row);
  totals.callCount += row.call_count;
  if (row.status === "success") totals.successCount += row.call_count;
  else totals.failCount += row.call_count;
  totals.inputTokens += row.input_tokens;
  totals.outputTokens += row.output_tokens;
  totals.creditsUsed += row.credits_used;
  // row.input_tokens/output_tokens are already summed across row.call_count
  // calls (grouped in SQL), so rowCost() is already the total for this row.
  totals.costUsd += costUsd;
  if (!verified) totals.allVerified = false;
}

export function computeUsageReport(rows: AdminUsageGroupedRow[], todayStr: string) {
  const overall = emptyTotals();
  const today = emptyTotals();
  const byCategory = new Map<UsageCategory, Totals>();
  const byModel = new Map<string, Totals>();
  const byUser = new Map<string, { email: string; totals: Totals }>();

  for (const row of rows) {
    addRow(overall, row);
    if (row.day === todayStr) addRow(today, row);

    const category = categorize(row);
    const catTotals = byCategory.get(category) ?? emptyTotals();
    addRow(catTotals, row);
    byCategory.set(category, catTotals);

    const modelKey = `${row.provider}/${row.model ?? "unknown"}`;
    const modelTotals = byModel.get(modelKey) ?? emptyTotals();
    addRow(modelTotals, row);
    byModel.set(modelKey, modelTotals);

    const userEntry = byUser.get(row.user_id) ?? { email: row.email, totals: emptyTotals() };
    addRow(userEntry.totals, row);
    byUser.set(row.user_id, userEntry);
  }

  const uniqueUsers = byUser.size;
  const avgCostPerUser = uniqueUsers > 0 ? overall.costUsd / uniqueUsers : 0;

  const topUsers = Array.from(byUser.entries())
    .map(([userId, v]) => ({ userId, email: v.email, ...v.totals }))
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 20);

  return {
    overall,
    today,
    avgCostPerUser,
    uniqueUsers,
    byCategory,
    byModel,
    topUsers,
  };
}
