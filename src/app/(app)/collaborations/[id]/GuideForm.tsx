"use client";

import { useActionState } from "react";
import { saveGuide, type SaveGuideState } from "./actions";

const initialState: SaveGuideState = null;

export function GuideForm({
  collaborationId,
  initialContent,
}: {
  collaborationId: string;
  initialContent: string;
}) {
  const boundAction = saveGuide.bind(null, collaborationId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-zinc-700">
          브랜드 가이드라인 원문 붙여넣기
        </span>
        <textarea
          name="raw_content"
          rows={10}
          defaultValue={initialContent}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
        />
      </label>

      {state && "error" in state && <p className="text-sm text-red-600">{state.error}</p>}
      {state && "success" in state && (
        <p className="text-sm text-emerald-600">저장되었습니다.</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "저장중..." : "가이드 저장"}
      </button>
    </form>
  );
}
