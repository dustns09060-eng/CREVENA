import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/States";
import { MessageCircleIcon } from "@/components/ui/Icon";

export default function CommentsDmPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col">
      <PageHeader title="댓글 / DM" />

      <div className="mt-6">
        <Card>
          <MessageCircleIcon size={24} className="mx-auto text-zinc-400" />
          <div className="mt-2">
            <EmptyState
              title="준비 중인 기능입니다."
              description="댓글과 DM을 한곳에서 모아보는 기능을 준비하고 있어요."
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
