"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

const VIDEO_BUCKET = "collaboration-videos";

// STEP39: the raw video bytes are uploaded directly browser -> Storage (see
// useVideoManager) since they can be tens of MB — well past what a server
// action/API route body limit should comfortably carry (photos, by
// contrast, are resized to small JPEGs first, which is why uploadPhoto in
// ../photos/actions.ts can take the bytes through a server action). This
// action only registers the already-uploaded object's metadata, mirroring
// uploadPhoto's row shape as closely as the extra video fields allow.
export async function registerVideo(input: {
  collaborationId: string;
  storagePath: string;
  originalFilename: string | null;
  mimeType: string | null;
  fileSizeBytes: number;
  durationSeconds: number;
  width: number;
  height: number;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const { count } = await supabase
    .from("collaboration_videos")
    .select("id", { count: "exact", head: true })
    .eq("collaboration_id", input.collaborationId);

  const { data, error } = await supabase
    .from("collaboration_videos")
    .insert({
      collaboration_id: input.collaborationId,
      user_id: user.id,
      storage_path: input.storagePath,
      original_filename: input.originalFilename,
      mime_type: input.mimeType,
      file_size_bytes: input.fileSizeBytes,
      duration_seconds: input.durationSeconds,
      width: input.width,
      height: input.height,
      display_order: count ?? 0,
    })
    .select("id")
    .single();

  if (error) return { error: `저장 실패: ${error.message}` };

  revalidatePath(`/collaborations/${input.collaborationId}/content`);
  return { success: true as const, id: data.id };
}

export async function reorderVideos(collaborationId: string, orderedIds: string[]) {
  const supabase = await createSupabaseServerClient();
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("collaboration_videos").update({ display_order: index }).eq("id", id),
    ),
  );
  revalidatePath(`/collaborations/${collaborationId}/content`);
}

export async function deleteVideo(collaborationId: string, videoId: string, storagePath: string) {
  const supabase = await createSupabaseServerClient();
  await supabase.storage.from(VIDEO_BUCKET).remove([storagePath]);
  await supabase.from("collaboration_videos").delete().eq("id", videoId);
  revalidatePath(`/collaborations/${collaborationId}/content`);
}

// STEP39 item 22: the whole Reels project (scene order/trim/captions/style/
// target duration/guide snapshot) lives in contents.generation_input jsonb
// for a platform='REELS' row — the exact same pattern STEP36 established for
// the blog's BlogMeta. No dedicated reels_projects table.
export type ReelsCaptionStyle = {
  preset: "basic" | "clean" | "emphasis";
  position: "top" | "middle" | "bottom";
  size: "small" | "medium" | "large";
};

export type ReelsScene = {
  id: string; // `photo:<collaboration_photos.id>` or `video:<collaboration_videos.id>`
  mediaType: "photo" | "video";
  mediaId: string;
  included: boolean;
  trimStart?: number;
  trimEnd?: number;
  durationSeconds: number;
  caption: string;
  captionVisible: boolean;
};

export type ReelsProject = {
  scenes: ReelsScene[];
  targetDurationSeconds: 15 | 30 | 60;
  captionStyle: ReelsCaptionStyle;
  guideTextAtGeneration?: string | null;
};

export async function saveReelsProject(input: {
  collaborationId: string;
  contentId?: string | null;
  project: ReelsProject;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  if (input.contentId) {
    const { error } = await supabase
      .from("contents")
      .update({ generation_input: input.project as unknown as Json })
      .eq("id", input.contentId);
    if (error) return { error: `저장 실패: ${error.message}` };
    revalidatePath(`/collaborations/${input.collaborationId}/content`);
    return { success: true as const, id: input.contentId };
  }

  const { data, error } = await supabase
    .from("contents")
    .insert({
      collaboration_id: input.collaborationId,
      user_id: user.id,
      platform: "REELS",
      status: "DRAFT",
      ai_provider: "claude",
      generation_input: input.project as unknown as Json,
    })
    .select("id")
    .single();

  if (error) return { error: `저장 실패: ${error.message}` };
  revalidatePath(`/collaborations/${input.collaborationId}/content`);
  return { success: true as const, id: data.id };
}
