import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { listProjectMedia, getGenerationState } from "../actions";
import { PhotoManager } from "./PhotoManager";
import { ShortsWorkflow } from "./ShortsWorkflow";
import { DeleteProjectButton } from "./DeleteProjectButton";
import type { ProductSource } from "@/lib/product-shorts/types";
import { emptyGenerationState } from "@/lib/product-shorts/recommendation-types";

export default async function ProductShortsDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  // RLS scopes this to the caller's own row — another user's projectId
  // simply returns no row here, same as every other ownership-sensitive
  // read in this feature.
  const { data: project } = await supabase
    .from("product_shorts_projects")
    .select("id, target_duration_seconds, product_source, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!project) notFound();

  const source = project.product_source as unknown as ProductSource;
  const media = await listProjectMedia(id);
  const stateResult = await getGenerationState(id);
  const generationState = "state" in stateResult ? stateResult.state : emptyGenerationState();
  const targetDurationSeconds = project.target_duration_seconds === 30 ? 30 : 15;

  return (
    <div>
      <PageHeader
        title={source?.productName || "(이름 없음)"}
        description={`${project.target_duration_seconds}초 · 판매용 숏츠 준비 중`}
        action={<DeleteProjectButton projectId={id} />}
      />

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-900">상품 정보</h2>
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          {source?.priceText && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-zinc-500">가격</dt>
              <dd className="text-zinc-900">{source.priceText}</dd>
            </div>
          )}
          {source?.description && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-zinc-500">설명</dt>
              <dd className="text-zinc-900">{source.description}</dd>
            </div>
          )}
          {source?.features && source.features.length > 0 && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-zinc-500">특징</dt>
              <dd className="text-zinc-900">
                <ul className="list-inside list-disc">
                  {source.features.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
        </dl>
      </Card>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-900">상품 사진</h2>
        <p className="mt-1 text-xs text-zinc-500">
          판매 및 광고 콘텐츠에 사용할 권한이 있는 사진만 업로드해 주세요.
        </p>
        <PhotoManager projectId={id} initialMedia={media} />
      </Card>

      <ShortsWorkflow
        projectId={id}
        targetDurationSeconds={targetDurationSeconds}
        initialMedia={media}
        initialState={generationState}
      />
    </div>
  );
}
