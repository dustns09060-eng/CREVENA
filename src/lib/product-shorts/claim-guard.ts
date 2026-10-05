// Server-side backstop for the "no unsupported sales claims" rule. The prompts
// already forbid these expressions, but a prompt is only a request; this checks
// what the model actually returned.
//
// A banned expression is rejected unless the product's own source text (name,
// price, description, features, evidence values) already contains it — i.e. the
// seller/page itself said it. Matching is deliberately conservative.

const BANNED_CLAIMS: { label: string; pattern: RegExp }[] = [
  { label: "1위", pattern: /(^|[^0-9])1\s*위/ },
  { label: "최저가", pattern: /최저\s*가/ },
  { label: "품절대란", pattern: /품절\s*대란/ },
  { label: "품절임박", pattern: /품절\s*임박/ },
  { label: "판매폭발", pattern: /판매\s*폭발/ },
  { label: "완판", pattern: /완판/ },
  { label: "오늘만", pattern: /오늘\s*만/ },
  { label: "한정수량", pattern: /한정\s*수량|수량\s*한정/ },
  { label: "후기 수", pattern: /(후기|리뷰)\s*(수|가\s*많|[0-9,]+\s*(개|건))/ },
  { label: "만족도", pattern: /만족\s*도/ },
  { label: "베스트셀러", pattern: /베스트\s*셀러/ },
  { label: "무조건", pattern: /무조건/ },
  { label: "난리난", pattern: /난리\s*난/ },
  { label: "역대급", pattern: /역대급/ },
];

export function sourceTextOf(source: {
  productName: string;
  priceText?: string | null;
  description?: string | null;
  features: string[];
  evidence: { value: string }[];
}): string {
  return [
    source.productName,
    source.priceText ?? "",
    source.description ?? "",
    ...source.features,
    ...source.evidence.map((e) => e.value),
  ].join("\n");
}

/** Banned expressions found in `text` that the product's own source text does not contain. */
export function findUnsupportedClaims(text: string, sourceText: string): string[] {
  const found: string[] = [];
  for (const { label, pattern } of BANNED_CLAIMS) {
    if (pattern.test(text) && !pattern.test(sourceText)) found.push(label);
  }
  return found;
}
