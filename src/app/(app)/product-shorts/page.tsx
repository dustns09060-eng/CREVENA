import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { ProductSource } from "@/lib/product-shorts/types";

// Independent from collaborations by design (see the Product Shorts PR
// report — sellers without a sponsorship collaboration are the primary
// audience). Lists the caller's own product_shorts_projects only (RLS).
export default async function ProductShortsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: projects } = await supabase
    .from("product_shorts_projects")
    .select("id, target_duration_seconds, product_source, created_at")
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader
        title="상품 판매 숏츠"
        description="판매 링크 또는 상품 정보와 사진으로 판매용 숏츠를 준비하는 공간이에요. 완성된 영상은 직접 다운로드해서 원하는 곳에 올리시면 됩니다."
        action={
          <Link href="/product-shorts/new">
            <Button>새 프로젝트</Button>
          </Link>
        }
      />

      <Card className="mt-6 p-0">
        {!projects || projects.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-400">아직 만든 프로젝트가 없어요.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {projects.map((p) => {
              const source = p.product_source as unknown as ProductSource;
              return (
                <li key={p.id}>
                  <Link
                    href={`/product-shorts/${p.id}`}
                    className="flex items-center justify-between px-4 py-3 text-sm hover:bg-zinc-50"
                  >
                    <span className="text-zinc-900">{source?.productName || "(이름 없음)"}</span>
                    <span className="text-zinc-500">{p.target_duration_seconds}초</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
