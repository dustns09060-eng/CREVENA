"use client";

import { useActionState } from "react";
import { addCreatorStyle, deleteCreatorStyle, type AddStyleState } from "./actions";
import { CREATOR_STYLE_PRESETS } from "@/lib/creator-style-presets";
import type { CreatorStyle } from "@/types/database";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

const initialState: AddStyleState = null;

export function StyleManager({ styles }: { styles: CreatorStyle[] }) {
  const [state, formAction, pending] = useActionState(addCreatorStyle, initialState);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <form action={formAction} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">스타일 이름</span>
            <input
              name="style_name"
              list="style-presets"
              placeholder="예: 자연스러운 후기"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
            />
            <datalist id="style-presets">
              {CREATOR_STYLE_PRESETS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">내가 쓴 예시 글</span>
            <textarea
              name="sample_text"
              rows={6}
              placeholder="평소에 작성한 후기 글을 붙여넣어주세요."
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
            />
          </label>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

          <Button type="submit" loading={pending} loadingText="저장중..." className="w-fit">
            스타일 추가
          </Button>
        </form>
      </Card>

      <div className="flex flex-col gap-3">
        {styles.length === 0 ? (
          <p className="text-sm text-zinc-500">저장된 스타일이 없습니다.</p>
        ) : (
          styles.map((s) => (
            <Card key={s.id}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-zinc-900">{s.style_name}</span>
                <button
                  onClick={() => deleteCreatorStyle(s.id)}
                  className="text-sm text-red-600 hover:underline"
                >
                  삭제
                </button>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600">{s.sample_text}</p>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
