import type { CollaborationStatus, ProvisionType } from "@/types/database";

export const COLLABORATION_STATUS_LABELS: Record<CollaborationStatus, string> = {
  APPLIED: "지원중",
  SELECTED: "선정",
  SHIPPING: "배송중",
  RECEIVED: "제품수령",
  SHOOTING: "촬영필요",
  WRITING: "작성중",
  REVIEW: "검수중",
  UPLOAD_READY: "업로드대기",
  COMPLETED: "완료",
  PAYMENT_PENDING: "정산대기",
  PAID: "정산완료",
};

export const COLLABORATION_STATUSES = Object.keys(
  COLLABORATION_STATUS_LABELS,
) as CollaborationStatus[];

export const PROVISION_TYPE_LABELS: Record<ProvisionType, string> = {
  PRODUCT: "제품 제공",
  FEE: "원고료",
  PRODUCT_AND_FEE: "제품 + 원고료",
};
