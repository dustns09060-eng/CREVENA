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
