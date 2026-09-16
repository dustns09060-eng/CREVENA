// Centralized so the retry schedule can be tuned without touching billing
// logic. RETRY_POLICY_DAYS[i] is the delay (in days) before the (i+1)-th
// retry attempt, counted from the failure that just happened. Once
// retryCount exceeds the list length, retries are exhausted and the
// subscription is expired.
export const RETRY_POLICY_DAYS = [1, 3, 5];

export function getNextRetryDelayDays(retryCountAfterThisFailure: number): number | null {
  const index = retryCountAfterThisFailure - 1;
  if (index < 0 || index >= RETRY_POLICY_DAYS.length) return null;
  return RETRY_POLICY_DAYS[index];
}
