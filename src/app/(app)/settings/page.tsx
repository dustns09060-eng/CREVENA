import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StyleManager } from "./StyleManager";

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: styles } = await supabase
    .from("creator_styles")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900">설정</h1>

      <section className="mt-6">
        <h2 className="text-lg font-semibold text-zinc-900">결제</h2>
        <p className="mt-1 text-sm text-zinc-500">현재 플랜, 구독 상태, 결제 내역을 확인합니다.</p>
        <Link
          href="/settings/billing"
          className="mt-3 inline-block rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          결제 내역 보기
        </Link>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold text-zinc-900">내 글 스타일</h2>
        <p className="mt-1 text-sm text-zinc-500">
          평소 작성 스타일을 저장해두면 AI 콘텐츠 생성 시 참고합니다.
        </p>
        <div className="mt-4">
          <StyleManager styles={styles ?? []} />
        </div>
      </section>
    </div>
  );
}
