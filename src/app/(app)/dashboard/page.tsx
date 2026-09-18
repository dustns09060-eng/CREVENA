import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { COLLABORATION_STATUS_LABELS } from "@/lib/collaboration-status";
import { formatDDay } from "@/lib/dday";
import { buildDeadlineNotifications } from "@/lib/notifications";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/States";
import { AlertTriangleIcon, PlusIcon } from "@/components/ui/Icon";

function getThisWeekRange(now: Date) {
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + mondayOffset);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end };
}

function DashboardCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-zinc-900">{value}</p>
    </Card>
  );
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data: collaborations, error } = await supabase
    .from("collaborations")
    .select("id, brand_name, product_name, status, content_deadline, created_at")
    .order("created_at", { ascending: false });

  if (error || !collaborations) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">대시보드</h1>
        <p className="mt-4 text-sm text-red-600">
          데이터를 불러오지 못했습니다: {error?.message}
        </p>
      </div>
    );
  }

  const isFinished = (status: string) => status === "COMPLETED" || status === "PAID";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { start: weekStart, end: weekEnd } = getThisWeekRange(today);

  const inProgress = collaborations.filter((c) => !isFinished(c.status));
  const thisWeekDeadline = inProgress.filter((c) => {
    if (!c.content_deadline) return false;
    const d = new Date(c.content_deadline);
    return d >= weekStart && d <= weekEnd;
  });
  const shooting = collaborations.filter((c) => c.status === "SHOOTING");
  const writing = collaborations.filter((c) => c.status === "WRITING");
  const uploadReady = collaborations.filter((c) => c.status === "UPLOAD_READY");
  const completed = collaborations.filter((c) => isFinished(c.status));

  const notifications = buildDeadlineNotifications(collaborations, today);

  const recentCollaborations = collaborations.slice(0, 5);
  const upcomingDeadlines = inProgress
    .filter((c) => c.content_deadline && new Date(c.content_deadline) >= today)
    .sort(
      (a, b) =>
        new Date(a.content_deadline!).getTime() - new Date(b.content_deadline!).getTime(),
    )
    .slice(0, 5);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col">
      <PageHeader
        title="대시보드"
        description="지금 무엇을 해야 하는지 한눈에 확인하세요."
        action={
          <Link href="/collaborations/new">
            <Button>
              <PlusIcon size={16} /> 새 협찬 등록
            </Button>
          </Link>
        }
      />

      {collaborations.length === 0 && (
        <div className="mt-4">
          <EmptyState
            title="첫 협찬을 등록해보세요."
            description="협찬 가이드와 사진을 등록하면 AI가 채널별 콘텐츠 제작을 도와드려요."
            action={
              <Link href="/collaborations/new">
                <Button>협찬 등록하기</Button>
              </Link>
            }
          />
        </div>
      )}

      {notifications.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {notifications.map((n) => (
            <Link
              key={n.collaborationId + n.message}
              href={`/collaborations/${n.collaborationId}`}
              className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 hover:bg-amber-100"
            >
              <AlertTriangleIcon size={14} className="shrink-0" />
              {n.message}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <DashboardCard label="진행중" value={inProgress.length} />
        <DashboardCard label="이번주 마감" value={thisWeekDeadline.length} />
        <DashboardCard label="촬영필요" value={shooting.length} />
        <DashboardCard label="작성중" value={writing.length} />
        <DashboardCard label="업로드대기" value={uploadReady.length} />
        <DashboardCard label="완료" value={completed.length} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-zinc-900">최근 협찬</h2>
          {recentCollaborations.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">등록된 협찬이 없습니다.</p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-zinc-100">
              {recentCollaborations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/collaborations/${c.id}`}
                    className="flex items-center justify-between py-2 text-sm hover:text-zinc-900"
                  >
                    <span className="text-zinc-900">
                      {c.brand_name} · {c.product_name}
                    </span>
                    <span className="text-zinc-500">{COLLABORATION_STATUS_LABELS[c.status]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-zinc-900">다가오는 마감</h2>
          {upcomingDeadlines.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">다가오는 마감이 없습니다.</p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-zinc-100">
              {upcomingDeadlines.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/collaborations/${c.id}`}
                    className="flex items-center justify-between py-2 text-sm hover:text-zinc-900"
                  >
                    <span className="text-zinc-900">
                      {c.brand_name} · {c.product_name}
                    </span>
                    <span className="text-zinc-500">{formatDDay(c.content_deadline)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
