"use client";

import { useActionState } from "react";
import { createCollaboration, type CreateCollaborationState } from "./actions";
import { UPLOAD_PLATFORM_LABELS, UPLOAD_PLATFORMS } from "@/lib/upload-platforms";

const initialState: CreateCollaborationState = null;

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-zinc-700">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900";

export function CollaborationForm() {
  const [state, formAction, pending] = useActionState(createCollaboration, initialState);

  return (
    <form action={formAction} className="mt-6 flex max-w-2xl flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-zinc-900">기본 정보</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="브랜드명 *">
            <input name="brand_name" required className={inputClass} />
          </Field>
          <Field label="제품명 *">
            <input name="product_name" required className={inputClass} />
          </Field>
          <Field label="캠페인명">
            <input name="campaign_name" className={inputClass} />
          </Field>
          <Field label="협찬 플랫폼">
            <input name="platform" placeholder="예: 레뷰, 티블" className={inputClass} />
          </Field>
          <Field label="협찬 사이트">
            <input name="platform_site_url" type="url" className={inputClass} />
          </Field>
          <Field label="담당자 이름">
            <input name="manager_name" className={inputClass} />
          </Field>
          <Field label="담당자 연락처">
            <input name="manager_contact" className={inputClass} />
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-zinc-900">제공 및 일정</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="제공 방식">
            <select name="provision_type" defaultValue="" className={inputClass}>
              <option value="">선택 안 함</option>
              <option value="PRODUCT">제품 제공</option>
              <option value="FEE">원고료</option>
              <option value="PRODUCT_AND_FEE">제품 + 원고료</option>
            </select>
          </Field>
          <div />
          <Field label="제품 가격">
            <input name="product_price" type="number" min={0} step="1" className={inputClass} />
          </Field>
          <Field label="원고료">
            <input name="writing_fee" type="number" min={0} step="1" className={inputClass} />
          </Field>
          <Field label="제품 수령일">
            <input name="product_received_date" type="date" className={inputClass} />
          </Field>
          <Field label="콘텐츠 마감일">
            <input name="content_deadline" type="date" className={inputClass} />
          </Field>
          <Field label="정산 예정일">
            <input name="payment_due_date" type="date" className={inputClass} />
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-zinc-900">업로드 플랫폼</h2>
        <div className="flex flex-wrap gap-4">
          {UPLOAD_PLATFORMS.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" name="upload_platforms" value={p} />
              {UPLOAD_PLATFORM_LABELS[p]}
            </label>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-zinc-900">가이드</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="필수 키워드">
            <input name="required_keywords" className={inputClass} />
          </Field>
          <Field label="필수 해시태그">
            <input name="required_hashtags" className={inputClass} />
          </Field>
          <Field label="필수 계정 태그">
            <input name="required_mentions" className={inputClass} />
          </Field>
          <Field label="필수 사진 수">
            <input name="required_photo_count" type="number" min={0} step="1" className={inputClass} />
          </Field>
          <Field label="필수 영상">
            <input name="required_video_info" placeholder="예: 15초 릴스 1개" className={inputClass} />
          </Field>
          <Field label="광고 표시 문구">
            <input name="ad_disclosure_text" placeholder="예: #광고 #협찬" className={inputClass} />
          </Field>
        </div>
        <Field label="콘텐츠 작성 가이드">
          <textarea name="content_guide" rows={4} className={inputClass} />
        </Field>
        <Field label="추가 메모">
          <textarea name="memo" rows={3} className={inputClass} />
        </Field>
      </section>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "저장중..." : "협찬 등록"}
      </button>
    </form>
  );
}
