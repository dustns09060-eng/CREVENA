import type { ScheduleType } from "@/types/database";

export const SCHEDULE_TYPE_LABELS: Record<ScheduleType, string> = {
  CONTENT_DEADLINE: "마감",
  SHOOTING: "촬영",
  UPLOAD: "업로드",
  PAYMENT: "정산",
};

export const SCHEDULE_TYPE_COLORS: Record<ScheduleType, string> = {
  CONTENT_DEADLINE: "bg-red-100 text-red-700",
  SHOOTING: "bg-amber-100 text-amber-700",
  UPLOAD: "bg-blue-100 text-blue-700",
  PAYMENT: "bg-emerald-100 text-emerald-700",
};
