"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { AlertTriangleIcon, CheckIcon, XIcon } from "@/components/ui/Icon";
import { parseXmpPreset, MAX_XMP_FILE_SIZE_BYTES } from "@/lib/photo-edit/xmp-parser";
import { applyPhotoAdjustments } from "@/lib/photo-edit/engine";
import { bitmapToCanvas, canvasToJpegBlob, loadImageBitmap, MAX_PREVIEW_DIMENSION } from "@/lib/photo-edit/canvas-utils";
import type { PhotoAdjustments, XmpParseResult } from "@/lib/photo-edit/types";
import {
  applyPhotoEdit,
  deletePhotoPreset,
  getOriginalPhotoUrl,
  listPhotoPresets,
  replacePhotoPreset,
  restorePhotoOriginal,
  savePhotoPreset,
} from "./photo-edit-actions";
import type { PhotoWithUrl } from "./usePhotoManager";

type StoredPreset = { id: string; preset_name: string; source_filename: string | null; settings: PhotoAdjustments; updated_at: string };

type SelectedPreset = {
  presetName: string;
  sourceFilename: string | null;
  settings: PhotoAdjustments;
  savedPresetId: string | null; // set once persisted (or when chosen from "내 프리셋")
};

export function PhotoEditor({
  photo,
  allPhotos,
  collaborationId,
  onClose,
}: {
  photo: PhotoWithUrl;
  allPhotos: PhotoWithUrl[];
  collaborationId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalBitmapRef = useRef<ImageBitmap | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [presets, setPresets] = useState<StoredPreset[]>([]);
  const [selected, setSelected] = useState<SelectedPreset | null>(null);
  const [intensity, setIntensity] = useState(100);
  const [showOriginal, setShowOriginal] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyingAll, setApplyingAll] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [parseReport, setParseReport] = useState<XmpParseResult | null>(null);
  const [nameConflict, setNameConflict] = useState<{ existingId: string; pending: SelectedPreset } | null>(null);
  const [confirmBatchOpen, setConfirmBatchOpen] = useState(false);
  const hasEdit = !!photo.edited_storage_path;
  const applyingRef = useRef(false);
  const batchRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      const [urlRes, presetRes] = await Promise.all([getOriginalPhotoUrl(photo.id), listPhotoPresets()]);
      if (cancelled) return;
      if ("error" in urlRes) {
        setLoadError(urlRes.error ?? "사진을 불러오지 못했어요.");
        setLoading(false);
        return;
      }
      if ("presets" in presetRes) setPresets(presetRes.presets as unknown as StoredPreset[]);
      try {
        const bitmap = await loadImageBitmap(urlRes.url);
        if (cancelled) return;
        originalBitmapRef.current = bitmap;
        // Pre-select the photo's last-applied preset (if any) so intensity/before-after start from its current state.
        if (photo.edit_preset_name) {
          setSelected({
            presetName: photo.edit_preset_name,
            sourceFilename: null,
            settings: {},
            savedPresetId: null,
          });
          setIntensity(photo.edit_intensity ?? 100);
        }
        setLoading(false);
      } catch {
        if (!cancelled) {
          setLoadError("사진을 불러오지 못했어요.");
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
      originalBitmapRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id]);

  const draw = useMemo(
    () => async () => {
      const bitmap = originalBitmapRef.current;
      const canvas = canvasRef.current;
      if (!bitmap || !canvas) return;
      setRendering(true);
      try {
        const source = bitmapToCanvas(bitmap, MAX_PREVIEW_DIMENSION);
        const ctx = source.getContext("2d");
        if (!ctx) return;
        canvas.width = source.width;
        canvas.height = source.height;
        const outCtx = canvas.getContext("2d");
        if (!outCtx) return;
        if (showOriginal || !selected || Object.keys(selected.settings).length === 0) {
          outCtx.drawImage(source, 0, 0);
          return;
        }
        const imageData = ctx.getImageData(0, 0, source.width, source.height);
        const result = await applyPhotoAdjustments(imageData, selected.settings, intensity / 100, {
          yieldEveryRows: 999999, // preview is small enough to run in one go
        });
        outCtx.putImageData(result, 0, 0);
      } finally {
        setRendering(false);
      }
    },
    [selected, intensity, showOriginal],
  );

  useEffect(() => {
    if (!loading) void draw();
  }, [loading, draw]);

  async function handleXmpFile(file: File) {
    setError(null);
    setNotice(null);
    setParseReport(null);
    if (!file.name.toLowerCase().endsWith(".xmp")) {
      setError("지원되는 XMP 프리셋 파일이 아니에요.");
      return;
    }
    if (file.size > MAX_XMP_FILE_SIZE_BYTES) {
      setError("XMP 파일이 너무 커요. 다른 파일을 선택해주세요.");
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError("XMP 파일을 읽지 못했어요.");
      return;
    }
    const result = parseXmpPreset(text, file.name);
    setParseReport(result);
    if (!result.ok) {
      setError(result.error ?? "지원되는 XMP 프리셋 파일이 아니에요.");
      return;
    }
    if (Object.keys(result.adjustments).length === 0) {
      setError("이 프리셋에는 CREVENA가 적용할 수 있는 보정값이 없어요.");
      return;
    }

    const pending: SelectedPreset = {
      presetName: result.presetName,
      sourceFilename: file.name,
      settings: result.adjustments,
      savedPresetId: null,
    };

    const saveRes = await savePhotoPreset({
      presetName: pending.presetName,
      sourceFilename: pending.sourceFilename,
      settings: pending.settings,
    });
    if ("conflict" in saveRes && saveRes.conflict) {
      setNameConflict({ existingId: saveRes.existingId, pending });
      return;
    }
    if ("error" in saveRes) {
      setError(saveRes.error ?? "프리셋 저장에 실패했어요.");
      // Still let the user use it for this session even if saving failed.
      setSelected(pending);
      setIntensity(100);
      setShowOriginal(false);
      return;
    }
    setSelected({ ...pending, savedPresetId: saveRes.id });
    setPresets((prev) => [
      { id: saveRes.id, preset_name: pending.presetName, source_filename: pending.sourceFilename, settings: pending.settings, updated_at: new Date().toISOString() },
      ...prev.filter((p) => p.preset_name !== pending.presetName),
    ]);
    setIntensity(100);
    setShowOriginal(false);
  }

  async function resolveConflictReplace() {
    if (!nameConflict) return;
    const { existingId, pending } = nameConflict;
    const res = await replacePhotoPreset(existingId, { sourceFilename: pending.sourceFilename, settings: pending.settings });
    if ("error" in res) {
      setError(res.error ?? "요청에 실패했어요.");
    } else {
      setSelected({ ...pending, savedPresetId: existingId });
      setPresets((prev) => prev.map((p) => (p.id === existingId ? { ...p, source_filename: pending.sourceFilename, settings: pending.settings } : p)));
      setIntensity(100);
      setShowOriginal(false);
    }
    setNameConflict(null);
  }

  function resolveConflictUseOnceOnly() {
    if (!nameConflict) return;
    setSelected(nameConflict.pending);
    setIntensity(100);
    setShowOriginal(false);
    setNameConflict(null);
  }

  function selectStoredPreset(preset: StoredPreset) {
    setError(null);
    setSelected({ presetName: preset.preset_name, sourceFilename: preset.source_filename, settings: preset.settings, savedPresetId: preset.id });
    setIntensity(100);
    setShowOriginal(false);
  }

  async function handleDeletePreset(id: string) {
    const res = await deletePhotoPreset(id);
    if ("error" in res) {
      setError(res.error ?? "요청에 실패했어요.");
      return;
    }
    setPresets((prev) => prev.filter((p) => p.id !== id));
  }

  async function renderFullResBlobs(): Promise<{ full: Blob; thumb: Blob } | null> {
    const bitmap = originalBitmapRef.current;
    if (!bitmap || !selected) return null;
    const fullCanvas = bitmapToCanvas(bitmap);
    const ctx = fullCanvas.getContext("2d");
    if (!ctx) return null;
    const imageData = ctx.getImageData(0, 0, fullCanvas.width, fullCanvas.height);
    const resultData = await applyPhotoAdjustments(imageData, selected.settings, intensity / 100);
    ctx.putImageData(resultData, 0, 0);
    const fullBlob = await canvasToJpegBlob(fullCanvas, 0.9);

    const thumbCanvas = document.createElement("canvas");
    const thumbScale = Math.min(1, 320 / Math.max(fullCanvas.width, fullCanvas.height));
    thumbCanvas.width = Math.round(fullCanvas.width * thumbScale);
    thumbCanvas.height = Math.round(fullCanvas.height * thumbScale);
    const thumbCtx = thumbCanvas.getContext("2d");
    if (!thumbCtx) return null;
    thumbCtx.drawImage(fullCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const thumbBlob = await canvasToJpegBlob(thumbCanvas, 0.8);
    return { full: fullBlob, thumb: thumbBlob };
  }

  async function handleApplyCurrent() {
    if (applyingRef.current || !selected) return;
    applyingRef.current = true;
    setApplying(true);
    setError(null);
    try {
      const blobs = await renderFullResBlobs();
      if (!blobs) throw new Error("보정된 이미지를 만들지 못했어요.");
      const formData = new FormData();
      formData.set("edited", blobs.full, "edited.jpg");
      formData.set("editedThumbnail", blobs.thumb, "edited_thumb.jpg");
      formData.set("presetName", selected.presetName);
      formData.set("intensity", String(intensity));
      const res = await applyPhotoEdit(collaborationId, photo.id, formData);
      if ("error" in res) throw new Error(res.error);
      setNotice("이 사진에 보정을 적용했어요.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "보정 적용에 실패했어요.");
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  }

  async function handleApplyAll() {
    if (batchRef.current || !selected) return;
    batchRef.current = true;
    setApplyingAll(true);
    setError(null);
    setBatchProgress({ done: 0, total: allPhotos.length });
    try {
      for (let i = 0; i < allPhotos.length; i++) {
        const target = allPhotos[i];
        const urlRes = await getOriginalPhotoUrl(target.id);
        if ("error" in urlRes) continue;
        const bitmap = await loadImageBitmap(urlRes.url);
        try {
          const fullCanvas = bitmapToCanvas(bitmap);
          const ctx = fullCanvas.getContext("2d");
          if (!ctx) continue;
          const imageData = ctx.getImageData(0, 0, fullCanvas.width, fullCanvas.height);
          const resultData = await applyPhotoAdjustments(imageData, selected.settings, intensity / 100);
          ctx.putImageData(resultData, 0, 0);
          const fullBlob = await canvasToJpegBlob(fullCanvas, 0.9);

          const thumbCanvas = document.createElement("canvas");
          const scale = Math.min(1, 320 / Math.max(fullCanvas.width, fullCanvas.height));
          thumbCanvas.width = Math.round(fullCanvas.width * scale);
          thumbCanvas.height = Math.round(fullCanvas.height * scale);
          const thumbCtx = thumbCanvas.getContext("2d");
          if (!thumbCtx) continue;
          thumbCtx.drawImage(fullCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
          const thumbBlob = await canvasToJpegBlob(thumbCanvas, 0.8);

          const formData = new FormData();
          formData.set("edited", fullBlob, "edited.jpg");
          formData.set("editedThumbnail", thumbBlob, "edited_thumb.jpg");
          formData.set("presetName", selected.presetName);
          formData.set("intensity", String(intensity));
          await applyPhotoEdit(collaborationId, target.id, formData);
        } finally {
          bitmap.close();
        }
        setBatchProgress({ done: i + 1, total: allPhotos.length });
        await new Promise((r) => setTimeout(r, 0));
      }
      setNotice(`전체 ${allPhotos.length}장에 프리셋을 적용했어요.`);
      router.refresh();
    } catch {
      setError("전체 적용 중 문제가 발생했어요. 일부 사진만 반영되었을 수 있어요.");
    } finally {
      batchRef.current = false;
      setApplyingAll(false);
      setBatchProgress(null);
      setConfirmBatchOpen(false);
    }
  }

  async function handleRestore() {
    setError(null);
    const res = await restorePhotoOriginal(collaborationId, photo.id);
    if ("error" in res) {
      setError(res.error ?? "요청에 실패했어요.");
      return;
    }
    setSelected(null);
    setNotice("원본으로 되돌렸어요.");
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-0 sm:p-6">
      <div className="flex min-h-full w-full shrink-0 flex-col gap-4 self-start bg-white p-4 sm:min-h-0 sm:max-w-3xl sm:rounded-2xl sm:p-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-zinc-900">사진 편집</h2>
            <p className="mt-0.5 text-xs text-zinc-500">협찬 콘텐츠 제작 전에 색감을 빠르게 통일해보세요.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-full px-2 py-1 text-lg leading-none text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            ×
          </button>
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm text-zinc-500">사진을 불러오는 중이에요...</p>
        ) : loadError ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr,260px]">
            <div className="flex flex-col gap-2">
              <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
                <canvas ref={canvasRef} className="w-full" />
                {rendering && (
                  <span className="absolute bottom-2 right-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">
                    렌더링 중...
                  </span>
                )}
              </div>
              <button
                type="button"
                onMouseDown={() => setShowOriginal(true)}
                onMouseUp={() => setShowOriginal(false)}
                onMouseLeave={() => setShowOriginal(false)}
                onTouchStart={() => setShowOriginal(true)}
                onTouchEnd={() => setShowOriginal(false)}
                className="self-center rounded-full border border-zinc-300 px-4 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
              >
                누르고 있으면 원본 보기
              </button>

              {hasEdit && (
                <p className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                  <CheckIcon size={12} /> 이 사진은 &quot;{photo.edit_preset_name}&quot; 보정이 적용되어 있어요 (강도 {photo.edit_intensity}%).
                </p>
              )}

              {selected && (
                <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <div className="flex items-center justify-between text-xs font-semibold text-zinc-600">
                    <span>강도 {intensity}%</span>
                    <span className="text-zinc-400">0% = 원본 · 100% = 프리셋 전체</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={intensity}
                    onChange={(e) => setIntensity(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              )}

              {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
              {notice && (
                <p className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  <CheckIcon size={12} /> {notice}
                </p>
              )}

              {parseReport && (parseReport.supported.length > 0 || parseReport.unsupported.length > 0) && (
                <div className="rounded-xl border border-zinc-200 bg-white p-3 text-xs">
                  {parseReport.supported.length > 0 && (
                    <p className="text-emerald-700">✓ 지원됨: {parseReport.supported.join(", ")}</p>
                  )}
                  {parseReport.unsupported.length > 0 && (
                    <p className="mt-1 text-amber-700">△ 이 프리셋의 일부 고급 보정은 CREVENA에서 다르게 표현되거나 적용되지 않아요: {parseReport.unsupported.join(", ")}</p>
                  )}
                </div>
              )}

              <div className="mt-1 flex flex-wrap gap-2">
                <Button onClick={handleApplyCurrent} disabled={!selected || applying || applyingAll} loading={applying} loadingText="이 사진을 보정하고 있어요">
                  현재 사진 적용
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setConfirmBatchOpen(true)}
                  disabled={!selected || applying || applyingAll || allPhotos.length === 0}
                >
                  전체 사진에 적용
                </Button>
                <Button variant="ghost" onClick={handleRestore} disabled={!hasEdit || applying || applyingAll}>
                  원본으로 되돌리기
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <p className="mb-1.5 text-xs font-semibold text-zinc-500">XMP 불러오기</p>
                <label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-zinc-300 px-3 py-3 text-xs font-medium text-zinc-600 hover:bg-zinc-50">
                  .xmp 파일 선택
                  <input
                    type="file"
                    accept=".xmp"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleXmpFile(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                <p className="mt-1 text-[10px] text-zinc-400">Lightroom / Camera Raw 프리셋(.xmp). 일부 고급 보정은 CREVENA에서 다르게 표현될 수 있어요.</p>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-semibold text-zinc-500">내 프리셋</p>
                {presets.length === 0 ? (
                  <p className="text-xs text-zinc-400">아직 업로드한 프리셋이 없어요.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {presets.map((p) => (
                      <li key={p.id} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => selectStoredPreset(p)}
                          className={`flex-1 truncate rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium ${
                            selected?.savedPresetId === p.id ? "border-brand-600 bg-brand-50 text-brand-700" : "border-zinc-200 text-zinc-700 hover:bg-zinc-50"
                          }`}
                        >
                          {p.preset_name}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePreset(p.id)}
                          aria-label="프리셋 삭제"
                          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-500"
                        >
                          <XIcon size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={!!nameConflict}
        onClose={() => setNameConflict(null)}
        title="같은 이름의 프리셋이 있어요"
        description="기존 프리셋을 이 내용으로 교체할까요, 이번만 저장 없이 사용할까요?"
      >
        <Button variant="ghost" onClick={() => setNameConflict(null)}>취소</Button>
        <Button variant="secondary" onClick={resolveConflictUseOnceOnly}>저장 없이 이번만 사용</Button>
        <Button onClick={resolveConflictReplace}>기존 프리셋 교체</Button>
      </Modal>

      <Modal
        open={confirmBatchOpen}
        onClose={() => setConfirmBatchOpen(false)}
        title="현재 협찬의 사진 전체에 이 프리셋을 적용할까요?"
        description={
          applyingAll
            ? `사진에 프리셋을 적용하고 있어요${batchProgress ? ` (${batchProgress.done}/${batchProgress.total})` : ""}`
            : `총 ${allPhotos.length}장의 사진이 대상이에요. 원본은 그대로 남아있고, 언제든 각 사진을 원본으로 되돌릴 수 있어요.`
        }
      >
        {applyingAll ? (
          <div className="flex items-center justify-center gap-2 py-2 text-xs text-zinc-500">
            <AlertTriangleIcon size={0} className="hidden" />
            사진에 프리셋을 적용하고 있어요...
          </div>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setConfirmBatchOpen(false)}>취소</Button>
            <Button onClick={handleApplyAll}>전체 적용</Button>
          </>
        )}
      </Modal>
    </div>
  );
}
