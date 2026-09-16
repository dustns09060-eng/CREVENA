import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { COLLABORATION_STATUS_LABELS } from "@/lib/collaboration-status";

export default async function ContentPage() {
  const supabase = await createSupabaseServerClient();
  const { data: collaborations } = await supabase
    .from("collaborations")
    .select("id, brand_name, product_name, status")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900">콘텐츠 제작</h1>
      <p className="mt-2 text-sm text-zinc-500">
        콘텐츠를 만들 협찬을 선택하세요. AI 콘텐츠 제작실은 협찬별로 열립니다.
      </p>

      <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        {!collaborations || collaborations.length === 0 ? (
          <p className="p-6 text-sm text-zinc-500">등록된 협찬이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {collaborations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/collaborations/${c.id}/content`}
                  className="flex items-center justify-between px-4 py-3 text-sm hover:bg-zinc-50"
                >
                  <span className="text-zinc-900">
                    {c.brand_name} · {c.product_name}
                  </span>
                  <span className="text-zinc-500">{COLLABORATION_STATUS_LABELS[c.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
