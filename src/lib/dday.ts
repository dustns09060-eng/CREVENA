export function formatDDay(dateStr: string | null): string {
  if (!dateStr) return "마감일 없음";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = new Date(dateStr);
  deadline.setHours(0, 0, 0, 0);

  const diffDays = Math.round((deadline.getTime() - today.getTime()) / 86400000);

  if (diffDays > 0) return `D-${diffDays}`;
  if (diffDays === 0) return "오늘마감";
  return `마감 ${Math.abs(diffDays)}일 지남`;
}
