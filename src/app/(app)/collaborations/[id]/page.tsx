import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  COLLABORATION_STATUS_LABELS,
  PROVISION_TYPE_LABELS,
} from "@/lib/collaboration-status";
import { UPLOAD_PLATFORM_LABELS } from "@/lib/upload-platforms";
import { formatDDay } from "@/lib/dday";
import { GuideForm } from "./GuideForm";
import { StatusControl } from "./StatusControl";
import { StatusStepper } from "./StatusStepper";

const TABS = [
  { key: "info", label: "기본정보" },
  { key: "guide", label: "가이드" },
  { key: "content", label: "콘텐츠 제작실" },
  { key: "schedule", label: "일정" },
  { key: "payment", label: "정산" },
  { key: "memo", label: "메모" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-zinc-100 py-2 last:border-0 sm:flex-row sm:gap-4">
      <span className="w-32 shrink-0 text-sm text-zinc-500">{label}</span>
      <span className="text-sm text-zinc-900">{value ?? "-"}</span>
    </div>
  );
}

export default async function CollaborationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === tabParam)?.key ?? "info") as TabKey;

  const supabase = await createSupabaseServerClient();
  const { data: collaboration } = await supabase
    .from("collaborations")
    .select("*")
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

  return (
    <div>
      <Link href="/collaborations" className="text-sm text-zinc-500 hover:text-zinc-900">
        ← 협찬관리
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-zinc-900">
          {collaboration.brand_name} · {collaboration.product_name}
        </h1>
        <span className="rounded-full bg-zinc-900 px-3 py-1 text-sm font-medium text-white">
          {formatDDay(collaboration.content_deadline)}
        </span>
      </div>

      <div className="mt-4">
        <StatusStepper currentStatus={collaboration.status} />
      </div>

      <div className="mt-3">
        <StatusControl collaborationId={id} currentStatus={collaboration.status} />
      </div>

      <div className="mt-6 flex flex-wrap gap-1 border-b border-zinc-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/collaborations/${id}?tab=${t.key}`}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
              tab === t.key
                ? "border-b-2 border-zinc-900 text-zinc-900"
                : "text-zinc-500 hover:text-zinc-900"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6">
        {tab === "info" && (
          <div className="flex flex-col">
            <InfoRow label="브랜드명" value={collaboration.brand_name} />
            <InfoRow label="제품명" value={collaboration.product_name} />
            <InfoRow label="캠페인명" value={collaboration.campaign_name} />
            <InfoRow label="협찬 플랫폼" value={collaboration.platform} />
            <InfoRow
              label="협찬 사이트"
              value={
                collaboration.platform_site_url ? (
                  <a
                    href={collaboration.platform_site_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-900 underline"
                  >
                    {collaboration.platform_site_url}
                  </a>
                ) : null
              }
            />
            <InfoRow label="담당자 이름" value={collaboration.manager_name} />
            <InfoRow label="담당자 연락처" value={collaboration.manager_contact} />
            <InfoRow
              label="업로드 플랫폼"
              value={
                collaboration.upload_platforms.length > 0
                  ? collaboration.upload_platforms
                      .map((p) => UPLOAD_PLATFORM_LABELS[p] ?? p)
                      .join(", ")
                  : null
              }
            />
          </div>
        )}

        {tab === "guide" && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="mb-2 text-sm font-semibold text-zinc-900">
                등록 시 입력한 가이드
              </h2>
              <div className="flex flex-col">
                <InfoRow label="필수 키워드" value={collaboration.required_keywords} />
                <InfoRow label="필수 해시태그" value={collaboration.required_hashtags} />
                <InfoRow label="필수 계정 태그" value={collaboration.required_mentions} />
                <InfoRow label="필수 사진 수" value={collaboration.required_photo_count} />
                <InfoRow label="필수 영상" value={collaboration.required_video_info} />
                <InfoRow label="광고 표시 문구" value={collaboration.ad_disclosure_text} />
                <InfoRow
                  label="콘텐츠 작성 가이드"
                  value={
                    collaboration.content_guide && (
                      <span className="whitespace-pre-wrap">{collaboration.content_guide}</span>
                    )
                  }
                />
              </div>
            </div>
            <div>
              <h2 className="mb-2 text-sm font-semibold text-zinc-900">
                브랜드 가이드라인 원문
              </h2>
              <GuideForm collaborationId={id} initialContent={guide?.raw_content ?? ""} />
            </div>
          </div>
        )}

        {tab === "content" && (
          <div>
            <p className="text-sm text-zinc-500">
              협찬 정보와 업로드한 사진을 공유 컨텍스트로 사용해 블로그 / Instagram / Threads 콘텐츠를
              한 곳에서 만듭니다.
            </p>
            <Link
              href={`/collaborations/${id}/content`}
              className="mt-3 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
            >
              콘텐츠 제작실 열기
            </Link>
          </div>
        )}

        {tab === "schedule" && (
          <div className="flex flex-col">
            <InfoRow label="제품 수령일" value={collaboration.product_received_date} />
            <InfoRow label="콘텐츠 마감일" value={collaboration.content_deadline} />
            <InfoRow label="정산 예정일" value={collaboration.payment_due_date} />
          </div>
        )}

        {tab === "payment" && (
          <div className="flex flex-col">
            <InfoRow
              label="제공 방식"
              value={
                collaboration.provision_type
                  ? PROVISION_TYPE_LABELS[collaboration.provision_type]
                  : null
              }
            />
            <InfoRow
              label="제품 가격"
              value={collaboration.product_price != null ? `${collaboration.product_price.toLocaleString()}원` : null}
            />
            <InfoRow
              label="원고료"
              value={collaboration.writing_fee != null ? `${collaboration.writing_fee.toLocaleString()}원` : null}
            />
            <InfoRow label="정산 예정일" value={collaboration.payment_due_date} />
            <InfoRow label="정산 상태" value={COLLABORATION_STATUS_LABELS[collaboration.status]} />
          </div>
        )}

        {tab === "memo" && (
          <p className="whitespace-pre-wrap text-sm text-zinc-900">
            {collaboration.memo || "메모가 없습니다."}
          </p>
        )}
      </div>
    </div>
  );
}
