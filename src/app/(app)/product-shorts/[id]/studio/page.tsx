import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { getGenerationState, getStudioPhotos } from "../../actions";
import { ShortsStudio } from "./ShortsStudio";
import type { ProductSource } from "@/lib/product-shorts/types";

export default async function ProductShortsStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { id } = await params;
  // ?version=<id> opens one A/B/C version; without it the project's single V1 plan is edited.
  const { version } = await searchParams;
  const versionId = typeof version === "string" && version ? version : null;
  const supabase = await createSupabaseServerClient();

  // RLS scopes this to the caller's own row.
  const { data: project } = await supabase
    .from("product_shorts_projects")
    .select("id, target_duration_seconds, product_source")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  const stateResult = await getGenerationState(id, versionId);
  if (versionId && "error" in stateResult) notFound(); // unknown / foreign version
  if (!("state" in stateResult) || !stateResult.state.plan) {
    // Editing is only available once an AI plan exists (no editor without a plan).
    redirect(`/product-shorts/${id}`);
  }
  const photosResult = await getStudioPhotos(id);
  if (!("photos" in photosResult)) notFound();

  const source = project.product_source as unknown as ProductSource;

  return (
    <div>
      <PageHeader
        title={`${source?.productName || "(이름 없음)"} — 숏츠 편집`}
        description={`${project.target_duration_seconds}초 · 장면을 다듬고 MP4로 만들어 보세요 (추가 크레딧 없음)`}
        action={
          <Link href={`/product-shorts/${id}`} className="text-sm text-zinc-600 underline">
            ← 상세로 돌아가기
          </Link>
        }
      />
      <div className="mt-6">
        <ShortsStudio
          projectId={id}
          versionId={versionId}
          initialPlan={stateResult.state.plan}
          initialPhotos={photosResult.photos}
        />
      </div>
    </div>
  );
}
