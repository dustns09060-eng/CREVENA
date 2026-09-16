import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StudioTabs } from "./StudioTabs";
import type { ContentPlatformKey, ReviewNotes } from "@/lib/ai/prompts";
import type { PlatformParts } from "./PlatformPanel";
import type { ContentStatus } from "@/types/database";

const BUCKET = "collaboration-photos";
const STUDIO_PLATFORMS: ContentPlatformKey[] = ["INSTAGRAM_FEED", "THREADS"];

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
      "brand_name, product_name, campaign_name, required_keywords, required_hashtags, required_mentions, ad_disclosure_text, content_guide, required_photo_count, review_notes",
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
    .select("id, platform, body, status, generation_input")
    .eq("collaboration_id", id)
    .in("platform", STUDIO_PLATFORMS)
    .order("created_at", { ascending: false });

  const initialContents: Partial<
    Record<ContentPlatformKey, { id: string; body: string; status: ContentStatus; generationInput: PlatformParts | null }>
  > = {};
  for (const platform of STUDIO_PLATFORMS) {
    const latest = existingContents?.find((c) => c.platform === platform);
    if (latest) {
      initialContents[platform] = {
        id: latest.id,
        body: latest.body ?? "",
        status: latest.status,
        generationInput: (latest.generation_input as PlatformParts | null) ?? null,
      };
    }
  }

  const { data: photos } = await supabase
    .from("collaboration_photos")
    .select("*")
    .eq("collaboration_id", id)
    .order("display_order", { ascending: true });

  const photoList = photos ?? [];
  const signedUrls = await Promise.all(
    photoList.map(async (p) => {
      const [full, thumb] = await Promise.all([
        supabase.storage.from(BUCKET).createSignedUrl(p.storage_path, 3600),
        supabase.storage.from(BUCKET).createSignedUrl(p.thumbnail_path, 3600),
      ]);
      return { fullUrl: full.data?.signedUrl ?? "", thumbUrl: thumb.data?.signedUrl ?? "" };
    }),
  );

  const photosWithUrls = photoList.map((p, i) => ({ ...p, ...signedUrls[i] }));

  const styleSamples = (styles ?? []).map((s) => ({
    styleName: s.style_name,
    sampleText: s.sample_text,
  }));

  return (
    <div>
      <Link
        href={`/collaborations/${id}?tab=content`}
        className="text-sm text-zinc-500 hover:text-zinc-900"
      >
        ← 협찬 상세로
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-zinc-900">CREVENA 통합 콘텐츠 제작실</h1>
      <p className="mt-1 text-sm text-zinc-500">
        사진과 실제 사용 경험을 바탕으로 블로그부터 SNS까지 한 번에 만들어보세요.
      </p>
      <p className="mt-1 text-xs font-medium text-zinc-400">
        {collaboration.brand_name} · {collaboration.product_name}
      </p>

      <div className="mt-6">
        <StudioTabs
          collaborationId={id}
          initialPhotos={photosWithUrls}
          initialReviewNotes={(collaboration.review_notes as ReviewNotes | null) ?? {}}
          initialInstagram={initialContents.INSTAGRAM_FEED}
          initialThreads={initialContents.THREADS}
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
            styleSamples,
          }}
          photoBlogInfo={{
            brandName: collaboration.brand_name,
            productName: collaboration.product_name,
            campaignName: collaboration.campaign_name,
            requiredKeywords: collaboration.required_keywords,
            requiredHashtags: collaboration.required_hashtags,
            adDisclosureText: collaboration.ad_disclosure_text,
            contentGuide: collaboration.content_guide,
            guideRawContent: guide?.raw_content ?? null,
            requiredPhotoCount: collaboration.required_photo_count,
            styleSamples,
          }}
        />
      </div>
    </div>
  );
}
