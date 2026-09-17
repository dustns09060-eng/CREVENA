// STEP33: deterministic (no AI call) portion of guideline checking. Anything
// that's a plain substring/length check has no business costing a credit or
// an AI round-trip — the AI-based check (GUIDE_CHECK operation, reused from
// the photo-blog flow) stays for the fuzzier "does this actually read like
// it satisfies the guideline" judgment.
export type DeterministicGuideCheck = {
  missingKeywords: string[];
  missingHashtags: string[];
  missingMentions: string[];
  charCount: number;
  hasAdDisclosure: boolean | null; // null when no disclosure text is required
};

function splitTerms(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function checkContentDeterministic(
  text: string,
  guide: {
    requiredKeywords?: string | null;
    requiredHashtags?: string | null;
    requiredMentions?: string | null;
    adDisclosureText?: string | null;
  },
): DeterministicGuideCheck {
  const haystack = text.toLowerCase();

  const missingKeywords = splitTerms(guide.requiredKeywords).filter(
    (k) => !haystack.includes(k.toLowerCase()),
  );
  const missingHashtags = splitTerms(guide.requiredHashtags).filter((h) => {
    const tag = h.startsWith("#") ? h : `#${h}`;
    return !haystack.includes(tag.toLowerCase());
  });
  const missingMentions = splitTerms(guide.requiredMentions).filter((m) => {
    const tag = m.startsWith("@") ? m : `@${m}`;
    return !haystack.includes(tag.toLowerCase());
  });

  const hasAdDisclosure = guide.adDisclosureText?.trim()
    ? haystack.includes(guide.adDisclosureText.trim().toLowerCase())
    : null;

  return {
    missingKeywords,
    missingHashtags,
    missingMentions,
    charCount: text.length,
    hasAdDisclosure,
  };
}

export function isDeterministicCheckPassing(result: DeterministicGuideCheck): boolean {
  return (
    result.missingKeywords.length === 0 &&
    result.missingHashtags.length === 0 &&
    result.missingMentions.length === 0 &&
    result.hasAdDisclosure !== false
  );
}

// STEP35.5: a single ✓/△/✕ display item for the guide-check UI (see
// GuideCheckList in src/app/(app)/collaborations/[id]/content/studio-ui.tsx).
// Defined here (not in the UI file) so this pure lib module and
// checkAgainstGuideAnalysis below can both produce them without a lib→UI
// import.
export type GuideCheckItem = {
  label: string;
  state: "pass" | "warn" | "fail";
  detail?: string;
  // STEP37 item 2: true only for "fail" items that are purely structural
  // (a missing keyword/phrase/hashtag/tag, or a short body) — safe for AI to
  // patch in without inventing any fact. Never set for anything requiring a
  // real experience, a real photo/video, or removing a prohibited phrase
  // (those need a human, not a text patch).
  autoFixable?: boolean;
};

// Deterministic (no AI call) comparison of generated content against the
// STEP35.5 structured guide analysis (src/lib/ai/guide-analysis-prompts.ts).
// Broader than checkContentDeterministic above: also covers minimum
// character/photo counts, required phrases/URLs, prohibited expressions, and
// the "requiresVideo" flag CREVENA can never verify automatically. Conceptual
// "requiredPoints" (e.g. "제품의 OO 기능을 언급해주세요") get a soft pass/warn
// via substring search rather than fail, since they may legitimately be
// phrased differently by the model — this mirrors item 19's instruction not
// to punish content for not repeating the guide's exact wording.
export function checkAgainstGuideAnalysis(
  content: { title?: string; body: string },
  analysis: {
    titleKeywords: string[];
    bodyKeywords: string[];
    minimumCharacters: number | null;
    minimumPhotos: number | null;
    requiresVideo: boolean;
    requiredPhrases: string[];
    hashtags: string[];
    accountTags: string[];
    requiredUrls: string[];
    prohibitedExpressions: string[];
    requiredPoints: string[];
  },
  context: { photoCount?: number } = {},
): GuideCheckItem[] {
  const items: GuideCheckItem[] = [];
  const titleLower = (content.title ?? "").toLowerCase();
  const bodyLower = content.body.toLowerCase();
  const fullLower = `${titleLower} ${bodyLower}`;

  const missingFrom = (haystack: string, terms: string[]) =>
    terms.filter((t) => t.trim() && !haystack.includes(t.trim().toLowerCase()));

  // content.title is only present for platforms that actually have a title
  // (currently the blog). Instagram/Threads pass no title at all, and must
  // not be judged against a title-keyword rule they have no field to satisfy
  // — otherwise this item can never turn green no matter what "AI로 보완"
  // writes into the body.
  if (analysis.titleKeywords.length > 0 && content.title !== undefined) {
    const missing = missingFrom(titleLower, analysis.titleKeywords);
    items.push({
      label: "제목 필수 키워드",
      state: missing.length === 0 ? "pass" : "fail",
      detail: missing.length > 0 ? `누락: ${missing.join(", ")}` : undefined,
      autoFixable: missing.length > 0,
    });
  }
  if (analysis.bodyKeywords.length > 0) {
    const missing = missingFrom(bodyLower, analysis.bodyKeywords);
    items.push({
      label: "본문 필수 키워드",
      state: missing.length === 0 ? "pass" : "fail",
      detail: missing.length > 0 ? `누락: ${missing.join(", ")}` : undefined,
      autoFixable: missing.length > 0,
    });
  }
  if (analysis.requiredPhrases.length > 0) {
    const missing = missingFrom(fullLower, analysis.requiredPhrases);
    items.push({
      label: "필수 문구",
      state: missing.length === 0 ? "pass" : "fail",
      detail: missing.length > 0 ? `누락: ${missing.join(", ")}` : undefined,
      autoFixable: missing.length > 0,
    });
  }
  if (analysis.hashtags.length > 0) {
    const missing = missingFrom(
      fullLower,
      analysis.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)),
    );
    items.push({
      label: "필수 해시태그",
      state: missing.length === 0 ? "pass" : "fail",
      detail: missing.length > 0 ? `누락: ${missing.join(", ")}` : undefined,
      autoFixable: missing.length > 0,
    });
  }
  if (analysis.accountTags.length > 0) {
    const missing = missingFrom(
      fullLower,
      analysis.accountTags.map((a) => (a.startsWith("@") ? a : `@${a}`)),
    );
    items.push({
      label: "필수 계정 태그",
      state: missing.length === 0 ? "pass" : "fail",
      detail: missing.length > 0 ? `누락: ${missing.join(", ")}` : undefined,
      autoFixable: missing.length > 0,
    });
  }
  if (analysis.requiredUrls.length > 0) {
    const missing = missingFrom(fullLower, analysis.requiredUrls);
    items.push({
      label: "필수 URL",
      state: missing.length === 0 ? "pass" : "fail",
      detail: missing.length > 0 ? `누락: ${missing.join(", ")}` : undefined,
    });
  }
  if (analysis.prohibitedExpressions.length > 0) {
    const found = analysis.prohibitedExpressions.filter(
      (t) => t.trim() && fullLower.includes(t.trim().toLowerCase()),
    );
    items.push({
      label: "금지 표현 미사용",
      state: found.length === 0 ? "pass" : "fail",
      detail: found.length > 0 ? `발견: ${found.join(", ")}` : undefined,
    });
  }
  if (analysis.minimumCharacters) {
    const count = content.body.length;
    items.push({
      label: "최소 글자 수",
      state: count >= analysis.minimumCharacters ? "pass" : "fail",
      detail: `${count}/${analysis.minimumCharacters}자`,
      autoFixable: count < analysis.minimumCharacters,
    });
  }
  if (analysis.minimumPhotos && context.photoCount !== undefined) {
    items.push({
      label: "사진 수 조건",
      state: context.photoCount >= analysis.minimumPhotos ? "pass" : "fail",
      detail: `${context.photoCount}/${analysis.minimumPhotos}장`,
    });
  }
  if (analysis.requiredPoints.length > 0) {
    const missing = missingFrom(fullLower, analysis.requiredPoints);
    if (missing.length > 0) {
      items.push({
        label: "필수 언급 포인트",
        state: "warn",
        detail: `표현이 다를 수 있어 직접 확인해주세요: ${missing.join(", ")}`,
      });
    } else {
      items.push({ label: "필수 언급 포인트", state: "pass" });
    }
  }
  if (analysis.requiresVideo) {
    items.push({
      label: "영상/GIF",
      state: "warn",
      detail: "가이드에 영상 또는 GIF가 필요하다고 명시되어 있습니다. 직접 확인해주세요.",
    });
  }

  return items;
}
