import { LoadingState } from "@/components/ui/States";

// STEP45: was a bare unstyled <p>, the only route-level loading state in the
// app that didn't use the shared LoadingState (spinner + label).
export default function Loading() {
  return <LoadingState label="불러오는 중..." />;
}
