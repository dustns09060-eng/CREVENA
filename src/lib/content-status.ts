import type { ContentStatus } from "@/types/database";

export const CONTENT_STATUS_LABELS: Record<ContentStatus, string> = {
  DRAFT: "초안",
  REVIEW: "검토중",
  APPROVED: "승인됨",
  POSTED: "게시완료",
};

export const CONTENT_STATUSES = Object.keys(CONTENT_STATUS_LABELS) as ContentStatus[];
