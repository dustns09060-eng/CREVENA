import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CONTENT_STATUS_LABELS, CONTENT_STATUSES } from "@/lib/content-status";
import { contentPlatformLabel } from "@/lib/content-platforms";
import { CopyButton } from "@/components/CopyButton";
import type { ContentPlatform } from "@/types/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, ErrorState } from "@/components/ui/States";

function platformLabel(platform: ContentPlatform) {
  return contentPlatformLabel(platform);
}

export default async function ContentLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{
    brand?: string;
    platform?: string;
    status?: string;
    from?: string;
    to?: string;
    q?: string;
  }>;
}) {
  const params = await searchParams;
  const brandFilter = params.brand ?? "";
  const platformFilter = params.platform ?? "";
  const statusFilter = params.status ?? "";
  const fromFilter = params.from ?? "";
  const toFilter = params.to ?? "";
  const q = (params.q ?? "").trim().toLowerCase();

  const supabase = await createSupabaseServerClient();

  const [{ data: collaborations, error: collabError }, { data: contents, error: contentError }] =
    await Promise.all([
      supabase.from("collaborations").select("id, brand_name, product_name"),
      supabase
        .from("contents")
        .select("id, collaboration_id, platform, status, body, created_at")
        .order("created_at", { ascending: false }),
    ]);

  const error = collabError ?? contentError;
  const collabMap = new Map((collaborations ?? []).map((c) => [c.id, c]));
  const brands = Array.from(new Set((collaborations ?? []).map((c) => c.brand_name))).sort();
  const platformsUsed = Array.from(new Set((contents ?? []).map((c) => c.platform)));

  const items = (contents ?? [])
    .map((c) => {
      const collab = collabMap.get(c.collaboration_id);
      return {
        ...c,
        brandName: collab?.brand_name ?? "(삭제된 협찬)",
        productName: collab?.product_name ?? "",
      };
    })
    .filter((item) => {
      if (brandFilter && item.brandName !== brandFilter) return false;
      if (platformFilter && item.platform !== platformFilter) return false;
      if (statusFilter && item.status !== statusFilter) return false;
      if (fromFilter && item.created_at < fromFilter) return false;
      if (toFilter && item.created_at.slice(0, 10) > toFilter) return false;
      if (q) {
        const haystack = `${item.brandName} ${item.productName} ${item.body ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

  function buildQuery(overrides: Record<string, string>) {
    const next = {
      brand: brandFilter,
      platform: platformFilter,
      status: statusFilter,
      from: fromFilter,
      to: toFilter,
      q: params.q ?? "",
      ...overrides,
    };
    const usp = new URLSearchParams();
    Object.entries(next).forEach(([k, v]) => {
      if (v) usp.set(k, v);
    });
    const qs = usp.toString();
    return qs ? `?${qs}` : "";
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col">
      <PageHeader title="콘텐츠 보관함" />

      <form className="mt-4 flex flex-wrap items-center gap-2" action="">
        {brandFilter && <input type="hidden" name="brand" value={brandFilter} />}
        {platformFilter && <input type="hidden" name="platform" value={platformFilter} />}
        {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
        <input
          type="text"
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="브랜드명, 제품명, 콘텐츠 내용 검색"
          className="w-72 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <label className="flex items-center gap-1.5 text-sm text-zinc-600">
          작성일
          <input
            type="date"
            name="from"
            defaultValue={fromFilter}
            className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </label>
        <span className="text-sm text-zinc-400">~</span>
        <input
          type="date"
          name="to"
          defaultValue={toFilter}
          className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
        />
        <Button type="submit" variant="secondary">
          검색
        </Button>
      </form>

      <div className="mt-3 flex flex-wrap gap-1">
        <Link
          href={`/content-library${buildQuery({ status: "" })}`}
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            !statusFilter ? "bg-brand-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
          }`}
        >
          전체 상태
        </Link>
        {CONTENT_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/content-library${buildQuery({ status: s })}`}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              statusFilter === s
                ? "bg-brand-600 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {CONTENT_STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        <Link
          href={`/content-library${buildQuery({ platform: "" })}`}
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            !platformFilter ? "bg-brand-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
          }`}
        >
          전체 종류
        </Link>
        {platformsUsed.map((p) => (
          <Link
            key={p}
            href={`/content-library${buildQuery({ platform: p })}`}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              platformFilter === p
                ? "bg-brand-600 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {platformLabel(p)}
          </Link>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {brands.length > 0 && (
          <>
            <Link
              href={`/content-library${buildQuery({ brand: "" })}`}
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                !brandFilter ? "bg-brand-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              전체 브랜드
            </Link>
            {brands.map((b) => (
              <Link
                key={b}
                href={`/content-library${buildQuery({ brand: b })}`}
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  brandFilter === b
                    ? "bg-brand-600 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                {b}
              </Link>
            ))}
          </>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {error ? (
          <ErrorState message={`목록을 불러오지 못했습니다: ${error.message}`} />
        ) : items.length === 0 ? (
          <Card>
            <EmptyState title="저장된 콘텐츠가 없습니다." />
          </Card>
        ) : (
          items.map((item) => (
            <Card key={item.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-900">
                    {item.brandName} · {item.productName}
                  </span>
                  <Badge>{platformLabel(item.platform)}</Badge>
                  <Badge>{CONTENT_STATUS_LABELS[item.status]}</Badge>
                  <span className="text-xs text-zinc-400">
                    {new Date(item.created_at).toLocaleDateString("ko-KR")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/collaborations/${item.collaboration_id}/content`}>
                    <Button variant="secondary" size="sm">
                      보기 · 수정
                    </Button>
                  </Link>
                  <CopyButton text={item.body ?? ""} />
                </div>
              </div>
              <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-zinc-600">
                {item.body}
              </p>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
