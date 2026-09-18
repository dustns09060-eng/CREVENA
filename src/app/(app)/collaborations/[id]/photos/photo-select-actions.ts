"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizePhotoSelection, type PhotoSelection } from "@/lib/photo-select";

// STEP47: persistence for the AI Photo Select selection state.
//
// Writes into collaborations.photo_select (migration 0026 — NOT applied to
// production by this step, same operator-applies-it rule as STEP45.2/
// STEP46). Until 0026 is applied, PostgREST rejects the update with
// "column ... does not exist" (SQLSTATE 42703 / PGRST204). That is caught
// here and reported as { persisted: false } so the UI can tell the user the
// truth ("이 브라우저에서만 유지됩니다") instead of silently pretending the
// selection was saved.
//
// Ownership: this goes through createSupabaseServerClient() (the user's own
// session, NOT the service role), so the existing collaborations RLS policy
// — user_id = auth.uid() — is what authorizes the write. A user can never
// write another user's selection, and no new policy was added.

const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

export type SavePhotoSelectionResult =
  | { persisted: true }
  | { persisted: false; reason: "NOT_MIGRATED" | "NOT_AUTHENTICATED" | "WRITE_FAILED" };

export async function savePhotoSelection(
  collaborationId: string,
  selection: PhotoSelection,
): Promise<SavePhotoSelectionResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { persisted: false, reason: "NOT_AUTHENTICATED" };

  // Re-validate server-side against the photos that actually exist and
  // actually belong to this collaboration, so nothing a client sends can
  // persist an id for a photo that isn't real (STEP47 item 60/61).
  const { data: photos } = await supabase
    .from("collaboration_photos")
    .select("id")
    .eq("collaboration_id", collaborationId);

  const clean = sanitizePhotoSelection(selection, (photos ?? []).map((p) => p.id));

  const { error } = await supabase
    .from("collaborations")
    .update({ photo_select: clean as never })
    .eq("id", collaborationId);

  if (error) {
    if (MISSING_COLUMN_CODES.has(error.code ?? "")) {
      return { persisted: false, reason: "NOT_MIGRATED" };
    }
    console.error("savePhotoSelection: db write failed", error.message);
    return { persisted: false, reason: "WRITE_FAILED" };
  }

  // Deliberately NO revalidatePath(): a selection change must not re-run
  // the Content Studio server component mid-edit, which would re-push
  // initialPhotos/initialPhotoSelection props and fight the user's in-flight
  // clicking (the same reason usePhotoManager persists memos without a
  // refresh).
  return { persisted: true };
}
