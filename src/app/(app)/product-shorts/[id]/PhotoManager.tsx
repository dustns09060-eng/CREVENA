"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { resizeImage } from "@/lib/image-resize";
import { Button } from "@/components/ui/Button";
import { uploadPhoto, deletePhoto, type ProductShortsMediaWithUrl } from "../actions";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Reuses the exact same client-side resize convention already established
// for collaboration photos (usePhotoManager.ts: 1568px full / 320px
// thumbnail, JPEG) — see the PR report for why this was reused rather than
// forked. Real MIME validation happens server-side (magic bytes), this
// client-side accept filter is just a UX convenience, never trusted.
export function PhotoManager({ projectId, initialMedia }: { projectId: string; initialMedia: ProductShortsMediaWithUrl[] }) {
  const router = useRouter();
  const [media, setMedia] = useState(initialMedia);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("JPG, PNG, WEBP 이미지만 업로드할 수 있어요.");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const [photoBlob, thumbBlob] = await Promise.all([resizeImage(file, 1568, 0.85), resizeImage(file, 320, 0.8)]);

      const formData = new FormData();
      formData.set("photo", photoBlob, "photo.jpg");
      formData.set("thumbnail", thumbBlob, "thumb.jpg");
      formData.set("filename", file.name);

      const result = await uploadPhoto(projectId, formData);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    } catch {
      setError("사진 업로드에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(mediaId: string) {
    setDeletingId(mediaId);
    const previous = media;
    setMedia((prev) => prev.filter((m) => m.id !== mediaId)); // optimistic
    const result = await deletePhoto(projectId, mediaId);
    setDeletingId(null);
    if ("error" in result) {
      setMedia(previous); // roll back the optimistic removal
      setError(result.error);
    }
  }

  return (
    <div className="mt-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {media.map((m) => (
          <div key={m.id} className="group relative aspect-square overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
            {m.thumbUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- signed URL, not a static/optimizable asset
              <img src={m.thumbUrl} alt={m.originalFilename ?? "상품 사진"} className="h-full w-full object-cover" />
            )}
            <button
              type="button"
              onClick={() => handleDelete(m.id)}
              disabled={deletingId === m.id}
              className="absolute top-1 right-1 rounded-full bg-black/60 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-50"
            >
              삭제
            </button>
          </div>
        ))}
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <input ref={inputRef} type="file" accept={ACCEPTED_TYPES.join(",")} className="hidden" onChange={handleFileChange} />
      <Button
        variant="secondary"
        className="mt-3"
        loading={uploading}
        loadingText="업로드 중..."
        onClick={() => inputRef.current?.click()}
      >
        사진 추가
      </Button>
    </div>
  );
}
