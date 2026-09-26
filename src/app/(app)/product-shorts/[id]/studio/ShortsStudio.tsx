"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShortFormEditor, type EditorPhoto } from "@/app/(app)/collaborations/[id]/reels/ShortFormEditor";
import type { ReelsProject } from "@/app/(app)/collaborations/[id]/reels/actions";
import type { VideoWithUrl } from "@/app/(app)/collaborations/[id]/reels/useVideoManager";
import { saveStudioPlan, getStudioPhotos, type StudioPhoto } from "../../actions";

// Signed URLs last 1 hour (SIGNED_URL_TTL_SECONDS in ../../actions.ts).
// Refresh well before that while the studio stays open.
const URL_REFRESH_INTERVAL_MS = 40 * 60 * 1000;
const EMPTY_VIDEOS = new Map<string, VideoWithUrl>(); // Product Shorts V1 is photo-only

function toMap(photos: StudioPhoto[]): Map<string, EditorPhoto> {
  return new Map(photos.map((p) => [p.id, { fullUrl: p.fullUrl, thumbUrl: p.thumbUrl }]));
}

// Product Shorts adapter around the shared ShortFormEditor: loads the stored
// plan, saves back to product_shorts_projects.reels_project.plan only, and
// hands the renderer fresh signed URLs. No AI is called anywhere in here.
export function ShortsStudio({
  projectId,
  initialPlan,
  initialPhotos,
}: {
  projectId: string;
  initialPlan: ReelsProject;
  initialPhotos: StudioPhoto[];
}) {
  const [project, setProject] = useState<ReelsProject>(initialPlan);
  const [photoById, setPhotoById] = useState(() => toMap(initialPhotos));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshPhotos = useCallback(async () => {
    const result = await getStudioPhotos(projectId);
    if (!("photos" in result)) return null;
    const map = toMap(result.photos);
    setPhotoById(map);
    return map;
  }, [projectId]);

  useEffect(() => {
    const timer = setInterval(() => {
      void refreshPhotos();
    }, URL_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refreshPhotos]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await saveStudioPlan(projectId, project);
      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      setDirty(false);
    } catch {
      setError("저장에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }, [projectId, project]);

  const noVideos = useMemo(() => EMPTY_VIDEOS, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <span className="text-xs text-zinc-400">{dirty ? "● 저장되지 않은 변경사항" : "✓ 저장됨"}</span>
      </div>
      {error && (
        <p className="whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      <ShortFormEditor
        project={project}
        onProjectChange={(updater) => {
          setProject((p) => updater(p));
          setDirty(true);
        }}
        photoById={photoById}
        videoById={noVideos}
        dirty={dirty}
        saving={saving}
        onSave={handleSave}
        downloadFileName={`product-shorts-${projectId}.mp4`}
        renderNote=" 만들어진 MP4는 기기에 저장만 됩니다 (서버에 보관하지 않아요)."
        onBeforeRender={refreshPhotos}
      />
    </div>
  );
}
