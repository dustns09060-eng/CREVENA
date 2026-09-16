type CollaborationForNotification = {
  id: string;
  brand_name: string;
  product_name: string;
  status: string;
  content_deadline: string | null;
};

export type DeadlineNotification = {
  collaborationId: string;
  message: string;
};

export function buildDeadlineNotifications(
  collaborations: CollaborationForNotification[],
  today: Date,
): DeadlineNotification[] {
  const notifications: DeadlineNotification[] = [];

  for (const c of collaborations) {
    if (!c.content_deadline) continue;
    if (c.status === "COMPLETED" || c.status === "PAID") continue;

    const deadline = new Date(c.content_deadline);
    deadline.setHours(0, 0, 0, 0);
    const diffDays = Math.round((deadline.getTime() - today.getTime()) / 86400000);

    const label = `${c.brand_name} · ${c.product_name}`;
    if (diffDays === 3) {
      notifications.push({ collaborationId: c.id, message: `${label} 콘텐츠 마감이 3일 남았습니다.` });
    } else if (diffDays === 1) {
      notifications.push({ collaborationId: c.id, message: `${label} 내일 콘텐츠 마감입니다.` });
    } else if (diffDays === 0) {
      notifications.push({ collaborationId: c.id, message: `${label} 오늘 콘텐츠 마감입니다.` });
    }
  }

  return notifications;
}
