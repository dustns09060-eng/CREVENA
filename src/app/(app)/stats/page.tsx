import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/States";
import { BarChartIcon } from "@/components/ui/Icon";

export default function StatsPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col">
      <PageHeader title="통계" />

      <div className="mt-6">
        <Card>
          <BarChartIcon size={24} className="mx-auto text-zinc-400" />
          <div className="mt-2">
            <EmptyState
              title="준비 중인 기능입니다."
              description="협찬과 콘텐츠 성과를 한눈에 볼 수 있는 통계를 준비하고 있어요."
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
