import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PhotoBlogStudio } from "./PhotoBlogStudio";
import type { ReviewNotes } from "@/lib/ai/prompts";

const BUCKET = "collaboration-photos";

export default async function CollaborationPhotosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: collaboration } = await supabase
    .from("collaborations")
    .select(
      "brand_name, product_name, campaign_name, required_keywords, required_hashtags, ad_disclosure_text, content_guide, required_photo_count, review_notes",
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

  return (
    <div>
      <Link
        href={`/collaborations/${id}?tab=photos`}
        className="text-sm text-zinc-500 hover:text-zinc-900"
      >
        ← 협찬 상세로
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-zinc-900">사진 기반 블로그 작성</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {collaboration.brand_name} · {collaboration.product_name}
      </p>

      <div className="mt-6">
        <PhotoBlogStudio
          collaborationId={id}
          initialPhotos={photosWithUrls}
          initialReviewNotes={(collaboration.review_notes as ReviewNotes | null) ?? {}}
          collaborationInfo={{
            brandName: collaboration.brand_name,
            productName: collaboration.product_name,
            campaignName: collaboration.campaign_name,
            requiredKeywords: collaboration.required_keywords,
            requiredHashtags: collaboration.required_hashtags,
            adDisclosureText: collaboration.ad_disclosure_text,
            contentGuide: collaboration.content_guide,
            guideRawContent: guide?.raw_content ?? null,
            requiredPhotoCount: collaboration.required_photo_count,
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
