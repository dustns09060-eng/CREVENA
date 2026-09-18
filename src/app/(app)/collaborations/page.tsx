import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  COLLABORATION_STATUS_LABELS,
  COLLABORATION_STATUSES,
} from "@/lib/collaboration-status";
import { formatDDay } from "@/lib/dday";
import type { CollaborationStatus } from "@/types/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { CheckIcon, PlusIcon } from "@/components/ui/Icon";

const FINISHED_STATUSES: CollaborationStatus[] = ["COMPLETED", "PAID"];

function deadlineUrgency(dateStr: string | null, status: CollaborationStatus) {
  if (!dateStr || FINISHED_STATUSES.includes(status)) return "normal" as const;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = new Date(dateStr);
  deadline.setHours(0, 0, 0, 0);
  const diffDays = Math.round((deadline.getTime() - today.getTime()) / 86400000);
  if (diffDays <= 3) return "urgent" as const;
  return "normal" as const;
}

function buildQuery(status: string, q: string) {
  const params = new URLSearchParams();
  if (status !== "ALL") params.set("status", status);
  if (q) params.set("q", q);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export default async function CollaborationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const params = await searchParams;
  const status = params.status ?? "ALL";
  const q = (params.q ?? "").trim();

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("collaborations")
    .select("id, brand_name, product_name, status, content_deadline")
    .order("content_deadline", { ascending: true, nullsFirst: false });

  if (status !== "ALL") {
    query = query.eq("status", status as CollaborationStatus);
  }
  if (q) {
    const escaped = q.replace(/[,%]/g, " ");
    query = query.or(`brand_name.ilike.%${escaped}%,product_name.ilike.%${escaped}%`);
  }

  const { data: collaborations, error } = await query;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col">
      <PageHeader
        title="협찬관리"
        action={
          <Link href="/collaborations/new">
            <Button>
              <PlusIcon size={16} /> 협찬 등록
            </Button>
          </Link>
        }
      />

      <form className="mt-4 flex gap-2" action="">
        {status !== "ALL" && <input type="hidden" name="status" value={status} />}
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="브랜드명 또는 제품명 검색"
          className="w-64 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <Button type="submit" variant="secondary">
          검색
        </Button>
      </form>

      <div className="mt-4 flex flex-wrap gap-1">
        <Link
          href={`/collaborations${buildQuery("ALL", q)}`}
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            status === "ALL" ? "bg-brand-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
          }`}
        >
          전체
        </Link>
        {COLLABORATION_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/collaborations${buildQuery(s, q)}`}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              status === s ? "bg-brand-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {COLLABORATION_STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        {error ? (
          <div className="p-6">
            <ErrorState message={`목록을 불러오지 못했습니다: ${error.message}`} />
          </div>
        ) : !collaborations || collaborations.length === 0 ? (
          <div className="p-2">
            <EmptyState
              title="협찬 내역이 없습니다."
              description="첫 협찬을 등록하면 여기에 표시돼요."
              action={
                <Link href="/collaborations/new">
                  <Button size="sm">협찬 등록하기</Button>
                </Link>
              }
            />
          </div>
        ) : (
          <table className="w-full min-w-[520px] text-left text-sm whitespace-nowrap">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">브랜드</th>
                <th className="px-4 py-3 font-medium">제품</th>
                <th className="px-4 py-3 font-medium">상태</th>
                <th className="px-4 py-3 font-medium">마감일</th>
              </tr>
            </thead>
            <tbody>
              {collaborations.map((c) => {
                const finished = FINISHED_STATUSES.includes(c.status);
                const urgent = deadlineUrgency(c.content_deadline, c.status) === "urgent";
                return (
                  <tr
                    key={c.id}
                    className={`cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 ${
                      finished ? "opacity-60" : ""
                    }`}
                  >
                    <td className="p-0">
                      <Link
                        href={`/collaborations/${c.id}`}
                        className={`block px-4 py-3 ${finished ? "text-zinc-500" : "text-zinc-900"}`}
                      >
                        {c.brand_name}
                      </Link>
                    </td>
                    <td className="p-0">
                      <Link
                        href={`/collaborations/${c.id}`}
                        className={`block px-4 py-3 ${finished ? "text-zinc-500" : "text-zinc-900"}`}
                      >
                        {c.product_name}
                      </Link>
                    </td>
                    <td className="p-0">
                      <Link href={`/collaborations/${c.id}`} className="block px-4 py-3">
                        <Badge tone={finished ? "success" : "neutral"}>
                          {finished && <CheckIcon size={11} />}
                          {COLLABORATION_STATUS_LABELS[c.status]}
                        </Badge>
                      </Link>
                    </td>
                    <td className="p-0">
                      <Link href={`/collaborations/${c.id}`} className="block px-4 py-3">
                        {urgent ? (
                          <Badge tone="danger">{formatDDay(c.content_deadline)}</Badge>
                        ) : (
                          <span className="text-zinc-500">{formatDDay(c.content_deadline)}</span>
                        )}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
