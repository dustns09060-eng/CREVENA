import { CollaborationForm } from "./CollaborationForm";
import { PageHeader } from "@/components/ui/PageHeader";

export default function NewCollaborationPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader title="협찬 등록" description="새로운 협찬 정보를 입력해주세요." />
      <CollaborationForm />
    </div>
  );
}
