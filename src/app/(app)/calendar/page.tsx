import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SCHEDULE_TYPE_COLORS, SCHEDULE_TYPE_LABELS } from "@/lib/schedule-type";
import type { ScheduleType } from "@/types/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/Icon";

type CalendarEvent = {
  date: string;
  type: ScheduleType;
  label: string;
  collaborationId: string;
};

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const params = await searchParams;
  const now = new Date();
  const year = Number(params.year) || now.getFullYear();
  const month = Number(params.month) || now.getMonth() + 1; // 1-12

  const monthStart = `${year}-${pad(month)}-01`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${pad(month)}-${pad(daysInMonth)}`;

  const supabase = await createSupabaseServerClient();
  const [{ data: collaborations, error: collabError }, { data: schedules, error: scheduleError }] =
    await Promise.all([
      supabase
        .from("collaborations")
        .select("id, brand_name, content_deadline, payment_due_date"),
      supabase
        .from("schedules")
        .select("id, collaboration_id, schedule_type, scheduled_date, title"),
    ]);

  const error = collabError ?? scheduleError;
  const collabMap = new Map((collaborations ?? []).map((c) => [c.id, c]));

  const events: CalendarEvent[] = [];
  for (const c of collaborations ?? []) {
    if (c.content_deadline) {
      events.push({
        date: c.content_deadline,
        type: "CONTENT_DEADLINE",
        label: c.brand_name,
        collaborationId: c.id,
      });
    }
    if (c.payment_due_date) {
      events.push({
        date: c.payment_due_date,
        type: "PAYMENT",
        label: c.brand_name,
        collaborationId: c.id,
      });
    }
  }
  for (const s of schedules ?? []) {
    const collab = collabMap.get(s.collaboration_id);
    events.push({
      date: s.scheduled_date,
      type: s.schedule_type,
      label: s.title || collab?.brand_name || "일정",
      collaborationId: s.collaboration_id,
    });
  }

  const eventsByDate = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    if (e.date < monthStart || e.date > monthEnd) continue;
    const list = eventsByDate.get(e.date) ?? [];
    list.push(e);
    eventsByDate.set(e.date, list);
  }

  const startWeekday = new Date(year, month - 1, 1).getDay();
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const prevMonth = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col">
      <PageHeader
        title="캘린더"
        action={
          <div className="flex items-center gap-2">
            <Link href={`/calendar?year=${prevMonth.year}&month=${prevMonth.month}`}>
              <Button variant="secondary" size="sm">
                <ChevronLeftIcon size={14} /> 이전달
              </Button>
            </Link>
            <span className="text-sm font-semibold text-zinc-900">
              {year}년 {month}월
            </span>
            <Link href={`/calendar?year=${nextMonth.year}&month=${nextMonth.month}`}>
              <Button variant="secondary" size="sm">
                다음달 <ChevronRightIcon size={14} />
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-zinc-500">
        {(Object.keys(SCHEDULE_TYPE_LABELS) as ScheduleType[]).map((t) => (
          <span key={t} className="flex items-center gap-1">
            <span className={`h-2.5 w-2.5 rounded-full ${SCHEDULE_TYPE_COLORS[t].split(" ")[0]}`} />
            {SCHEDULE_TYPE_LABELS[t]}
          </span>
        ))}
      </div>

      {error ? (
        <div className="mt-6">
          <ErrorState message={`일정을 불러오지 못했습니다: ${error.message}`} />
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <div className="grid min-w-[640px] grid-cols-7 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200">
            {WEEKDAY_LABELS.map((w) => (
              <div key={w} className="bg-zinc-50 px-2 py-1.5 text-center text-xs font-medium text-zinc-500">
                {w}
              </div>
            ))}
            {Array.from({ length: totalCells }).map((_, i) => {
              const dayNum = i - startWeekday + 1;
              const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
              const dateStr = inMonth ? `${year}-${pad(month)}-${pad(dayNum)}` : null;
              const dayEvents = dateStr ? eventsByDate.get(dateStr) ?? [] : [];
              const isToday = dateStr === todayStr;

              return (
                <div
                  key={i}
                  className={`min-h-[88px] bg-white p-1.5 ${inMonth ? "" : "bg-zinc-50"}`}
                >
                  {inMonth && (
                    <>
                      <span
                        className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                          isToday ? "bg-brand-600 text-white" : "text-zinc-500"
                        }`}
                      >
                        {dayNum}
                      </span>
                      <div className="mt-1 flex flex-col gap-0.5">
                        {dayEvents.map((e, idx) => (
                          <Link
                            key={idx}
                            href={`/collaborations/${e.collaborationId}`}
                            title={`${SCHEDULE_TYPE_LABELS[e.type]} · ${e.label}`}
                            className={`truncate rounded px-1 py-0.5 text-[11px] font-medium ${SCHEDULE_TYPE_COLORS[e.type]}`}
                          >
                            {e.label}
                          </Link>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
