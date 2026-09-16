import type { PhotoType } from "@/types/database";

export const PHOTO_TYPE_LABELS: Record<PhotoType, string> = {
  PRODUCT_ALONE: "제품 단독컷",
  PACKAGE: "패키지",
  COMPONENTS: "구성품",
  DETAIL: "디테일",
  USAGE: "사용 모습",
  KID_USAGE: "아이 사용 모습",
  FINAL_SHOT: "완성컷",
  OTHER: "기타",
};

export const PHOTO_TYPES = Object.keys(PHOTO_TYPE_LABELS) as PhotoType[];
