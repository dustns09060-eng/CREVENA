import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ContentStudio } from "./ContentStudio";
import type { ContentPlatformKey, ReviewNotes } from "@/lib/ai/prompts";
import type { ContentStatus } from "@/types/database";

const STUDIO_PLATFORMS: ContentPlatformKey[] = ["INSTAGRAM_FEED", "NAVER_BLOG", "THREADS"];

export default async function CollaborationContentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: collaboration } = await supabase
    .from("collaborations")
    .select(
      "brand_name, product_name, campaign_name, required_keywords, required_hashtags, required_mentions, ad_disclosure_text, content_guide, review_notes",
    )
    .eq("id", id)
    .maybeSingle();

  if (!collaboration) {
    notFound();
  }

  const { data: guide } = await supabase
    .from("collaboration_guides")
    .select("raw_content")
    .eq("collaboration_id", id)
    .maybeSingle();

  const { data: styles } = await supabase
    .from("creator_styles")
    .select("style_name, sample_text")
    .order("created_at", { ascending: false })
    .limit(5);

  const { data: existingContents } = await supabase
    .from("contents")
    .select("id, platform, body, status")
    .eq("collaboration_id", id)
    .in("platform", STUDIO_PLATFORMS)
    .order("created_at", { ascending: false });

  const initialContents: Partial<
    Record<ContentPlatformKey, { id: string; body: string; status: ContentStatus }>
  > = {};
  for (const platform of STUDIO_PLATFORMS) {
    const latest = existingContents?.find((c) => c.platform === platform);
    if (latest) {
      initialContents[platform] = { id: latest.id, body: latest.body ?? "", status: latest.status };
    }
  }

  return (
    <div>
      <Link
        href={`/collaborations/${id}?tab=content`}
        className="text-sm text-zinc-500 hover:text-zinc-900"
      >
        ← 협찬 상세로
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-zinc-900">AI 콘텐츠 제작실</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {collaboration.brand_name} · {collaboration.product_name}
      </p>

      <div className="mt-6">
        <ContentStudio
          collaborationId={id}
          initialContents={initialContents}
          initialReviewNotes={(collaboration.review_notes as ReviewNotes | null) ?? {}}
          collaborationInfo={{
            brandName: collaboration.brand_name,
            productName: collaboration.product_name,
            campaignName: collaboration.campaign_name,
            requiredKeywords: collaboration.required_keywords,
            requiredHashtags: collaboration.required_hashtags,
            requiredMentions: collaboration.required_mentions,
            adDisclosureText: collaboration.ad_disclosure_text,
            contentGuide: collaboration.content_guide,
            guideRawContent: guide?.raw_content ?? null,
            styleSamples: (styles ?? []).map((s) => ({
              styleName: s.style_name,
              sampleText: s.sample_text,
            })),
          }}
        />
      </div>
    </div>
  );
}
