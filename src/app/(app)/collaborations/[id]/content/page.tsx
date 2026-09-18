import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StudioTabs } from "./StudioTabs";
import type { ContentPlatformKey, ReviewNotes } from "@/lib/ai/prompts";
import type { PlatformParts } from "./PlatformPanel";
import type { BlogMeta } from "../photos/actions";
import type { ReelsProject } from "../reels/actions";
import type { CarouselProject } from "../carousel/actions";
import type { ContentStatus } from "@/types/database";
import { sanitizePhotoSelection } from "@/lib/photo-select";

const BUCKET = "collaboration-photos";
const VIDEO_BUCKET = "collaboration-videos";
const STUDIO_PLATFORMS: ContentPlatformKey[] = ["INSTAGRAM_FEED", "THREADS"];
const BLOG_PLATFORM = "NAVER_BLOG";
const REELS_PLATFORM = "REELS";
const CAROUSEL_PLATFORM = "CAROUSEL";
// STEP46: 네이버 클립 프로젝트. REELS와 같은 ReelsProject 모양이지만 platform
// 값이 달라 DB row가 분리되므로, 릴스 프로젝트를 덮어쓰지 않는다.
const NAVER_CLIP_PLATFORM = "NAVER_CLIP";

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

  // STEP47: read the saved AI Photo Select state in its OWN query, never
  // joined into the collaboration select above. Migration 0026 (which adds
  // collaborations.photo_select) is not applied to production by STEP47, so
  // this query can legitimately fail with "column does not exist" — and a
  // failure here must degrade the feature to session-only, never break
  // Content Studio. Sanitized against the real photo id set further below.
  const { data: photoSelectRow, error: photoSelectError } = await supabase
    .from("collaborations")
    .select("photo_select")
    .eq("id", id)
    .maybeSingle();
  if (photoSelectError) {
    console.warn(
      `collaborations.photo_select unavailable (STEP47 migration 0026 likely not applied): ${photoSelectError.message}`,
    );
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
    .in("platform", [
      ...STUDIO_PLATFORMS,
      BLOG_PLATFORM,
      REELS_PLATFORM,
      CAROUSEL_PLATFORM,
      NAVER_CLIP_PLATFORM,
    ])
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

  const latestBlog = existingContents?.find((c) => c.platform === BLOG_PLATFORM);
  const initialBlog = latestBlog
    ? {
        id: latestBlog.id,
        body: latestBlog.body ?? "",
        generationInput: (latestBlog.generation_input as BlogMeta | null) ?? null,
      }
    : undefined;

  const latestReels = existingContents?.find((c) => c.platform === REELS_PLATFORM);
  const initialReels = latestReels
    ? { id: latestReels.id, generationInput: (latestReels.generation_input as ReelsProject | null) ?? null }
    : undefined;

  // STEP46: 릴스와 완전히 별개의 row에서 읽어온다.
  const latestNaverClip = existingContents?.find((c) => c.platform === NAVER_CLIP_PLATFORM);
  const initialNaverClip = latestNaverClip
    ? { id: latestNaverClip.id, generationInput: (latestNaverClip.generation_input as ReelsProject | null) ?? null }
    : undefined;

  const latestCarousel = existingContents?.find((c) => c.platform === CAROUSEL_PLATFORM);
  const initialCarousel = latestCarousel
    ? { id: latestCarousel.id, generationInput: (latestCarousel.generation_input as CarouselProject | null) ?? null }
    : undefined;

  const { data: photos } = await supabase
    .from("collaboration_photos")
    .select("*")
    .eq("collaboration_id", id)
    .order("display_order", { ascending: true });

  const photoList = photos ?? [];
  // STEP43.5: this is the ONLY place fullUrl/thumbUrl are produced for a
  // photo — every consumer (Blog Studio, Naver Publish Assistant, Carousel
  // renderer, Reels renderer) just reads .fullUrl/.thumbUrl, so preferring
  // the edited derivative here (when one exists) is enough to make an XMP
  // edit show up everywhere without touching any of those files. If signing
  // the edited path unexpectedly fails (e.g. the object went missing), fall
  // back to the original so the app never shows a broken image — but still
  // log it, since a silent fallback shouldn't hide a real edited/original
  // mismatch forever.
  const signedUrls = await Promise.all(
    photoList.map(async (p) => {
      const effectiveFullPath = p.edited_storage_path ?? p.storage_path;
      const effectiveThumbPath = p.edited_thumbnail_path ?? p.thumbnail_path;
      let [full, thumb] = await Promise.all([
        supabase.storage.from(BUCKET).createSignedUrl(effectiveFullPath, 3600),
        supabase.storage.from(BUCKET).createSignedUrl(effectiveThumbPath, 3600),
      ]);
      if (p.edited_storage_path && (full.error || !full.data)) {
        console.error(`photo ${p.id}: edited_storage_path signed URL failed, falling back to original`, full.error);
        full = await supabase.storage.from(BUCKET).createSignedUrl(p.storage_path, 3600);
      }
      if (p.edited_thumbnail_path && (thumb.error || !thumb.data)) {
        console.error(`photo ${p.id}: edited_thumbnail_path signed URL failed, falling back to original`, thumb.error);
        thumb = await supabase.storage.from(BUCKET).createSignedUrl(p.thumbnail_path, 3600);
      }
      return { fullUrl: full.data?.signedUrl ?? "", thumbUrl: thumb.data?.signedUrl ?? "" };
    }),
  );

  const photosWithUrls = photoList.map((p, i) => ({ ...p, ...signedUrls[i] }));

  // Every stored photo id is re-validated against the photos that actually
  // exist right now, so an id left behind by a deleted photo (or a stale
  // write from another tab) can never reach the client.
  const initialPhotoSelection = photoSelectRow?.photo_select
    ? sanitizePhotoSelection(photoSelectRow.photo_select, photoList.map((p) => p.id))
    : null;

  const { data: videos } = await supabase
    .from("collaboration_videos")
    .select("*")
    .eq("collaboration_id", id)
    .order("display_order", { ascending: true });

  const videoList = videos ?? [];
  const videoSignedUrls = await Promise.all(
    videoList.map((v) => supabase.storage.from(VIDEO_BUCKET).createSignedUrl(v.storage_path, 3600)),
  );
  const videosWithUrls = videoList.map((v, i) => ({ ...v, url: videoSignedUrls[i].data?.signedUrl ?? "" }));

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
          initialGuideRawContent={guide?.raw_content ?? ""}
          initialReviewNotes={(collaboration.review_notes as ReviewNotes | null) ?? {}}
          initialInstagram={initialContents.INSTAGRAM_FEED}
          initialThreads={initialContents.THREADS}
          initialBlog={initialBlog}
          initialVideos={videosWithUrls}
          initialReels={initialReels}
          initialNaverClip={initialNaverClip}
          initialCarousel={initialCarousel}
          initialPhotoSelection={initialPhotoSelection}
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
            requiredMentions: collaboration.required_mentions,
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
