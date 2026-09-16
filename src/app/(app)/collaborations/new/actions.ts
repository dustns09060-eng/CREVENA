"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UPLOAD_PLATFORMS } from "@/lib/upload-platforms";
import { getPlanConfig } from "@/lib/plans";
import type { ProvisionType } from "@/types/database";

export type CreateCollaborationState = { error: string } | null;

const PROVISION_TYPES: ProvisionType[] = ["PRODUCT", "FEE", "PRODUCT_AND_FEE"];

function toNullableString(value: FormDataEntryValue | null) {
  const str = (value ?? "").toString().trim();
  return str === "" ? null : str;
}

function toNullableNumber(value: FormDataEntryValue | null) {
  const str = (value ?? "").toString().trim();
  if (str === "") return { value: null, error: null };
  const num = Number(str);
  if (Number.isNaN(num) || num < 0) {
    return { value: null, error: "0 이상의 숫자를 입력해주세요." };
  }
  return { value: num, error: null };
}

export async function createCollaboration(
  _prevState: CreateCollaborationState,
  formData: FormData,
): Promise<CreateCollaborationState> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "로그인이 필요합니다." };
  }

  // Downgrading never deletes existing collaborations, but a plan's storage
  // limit does block creating NEW ones once at/over it (STEP29).
  const { data: profile } = await supabase.from("users").select("plan_tier").eq("id", user.id).maybeSingle();
  const maxCollaborations = getPlanConfig(profile?.plan_tier).maxCollaborations;
  if (maxCollaborations !== null) {
    const { count } = await supabase
      .from("collaborations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    if ((count ?? 0) >= maxCollaborations) {
      return {
        error: `현재 플랜의 협찬 저장 한도(${maxCollaborations}건)를 초과했습니다. 기존 협찬을 정리하거나 플랜을 업그레이드해주세요.`,
      };
    }
  }

  const brandName = toNullableString(formData.get("brand_name"));
  const productName = toNullableString(formData.get("product_name"));
  if (!brandName || !productName) {
    return { error: "브랜드명과 제품명은 필수입니다." };
  }

  const provisionTypeRaw = toNullableString(formData.get("provision_type"));
  if (provisionTypeRaw && !PROVISION_TYPES.includes(provisionTypeRaw as ProvisionType)) {
    return { error: "제공 방식 값이 올바르지 않습니다." };
  }

  const productPrice = toNullableNumber(formData.get("product_price"));
  if (productPrice.error) return { error: `제품 가격: ${productPrice.error}` };

  const writingFee = toNullableNumber(formData.get("writing_fee"));
  if (writingFee.error) return { error: `원고료: ${writingFee.error}` };

  const requiredPhotoCount = toNullableNumber(formData.get("required_photo_count"));
  if (requiredPhotoCount.error) {
    return { error: `필수 사진 수: ${requiredPhotoCount.error}` };
  }

  const uploadPlatforms = formData
    .getAll("upload_platforms")
    .map((v) => v.toString())
    .filter((v) => UPLOAD_PLATFORMS.includes(v));

  const { error } = await supabase.from("collaborations").insert({
    user_id: user.id,
    brand_name: brandName,
    product_name: productName,
    campaign_name: toNullableString(formData.get("campaign_name")),
    platform: toNullableString(formData.get("platform")),
    platform_site_url: toNullableString(formData.get("platform_site_url")),
    manager_name: toNullableString(formData.get("manager_name")),
    manager_contact: toNullableString(formData.get("manager_contact")),
    provision_type: provisionTypeRaw as ProvisionType | null,
    product_price: productPrice.value,
    writing_fee: writingFee.value,
    product_received_date: toNullableString(formData.get("product_received_date")),
    content_deadline: toNullableString(formData.get("content_deadline")),
    payment_due_date: toNullableString(formData.get("payment_due_date")),
    upload_platforms: uploadPlatforms,
    required_keywords: toNullableString(formData.get("required_keywords")),
    required_hashtags: toNullableString(formData.get("required_hashtags")),
    required_mentions: toNullableString(formData.get("required_mentions")),
    required_photo_count: requiredPhotoCount.value,
    required_video_info: toNullableString(formData.get("required_video_info")),
    content_guide: toNullableString(formData.get("content_guide")),
    ad_disclosure_text: toNullableString(formData.get("ad_disclosure_text")),
    memo: toNullableString(formData.get("memo")),
  });

  if (error) {
    return { error: `저장 실패: ${error.message}` };
  }

  redirect("/collaborations");
}
