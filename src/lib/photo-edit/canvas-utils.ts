// STEP43.5 canvas helpers shared by the photo editor. All originals in this
// app are already canvas-resized JPEGs produced by resizeImage() at upload
// time (src/lib/image-resize.ts), which uses createImageBitmap() — browsers
// default that to imageOrientation: "from-image", so the stored bytes are
// already orientation-correct pixels with no EXIF rotation tag left to
// misinterpret. Loading them the same way here keeps that property; we
// never need to re-apply EXIF rotation ourselves.

export async function loadImageBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("사진을 불러오지 못했어요.");
  const blob = await res.blob();
  return createImageBitmap(blob);
}

export function bitmapToCanvas(bitmap: ImageBitmap, maxDimension?: number): HTMLCanvasElement {
  const scale = maxDimension ? Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height)) : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이 브라우저에서 사진 편집을 사용할 수 없어요.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

export function canvasToJpegBlob(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("이미지 변환에 실패했어요."))),
      "image/jpeg",
      quality,
    );
  });
}

// A single photo at full smartphone resolution (up to ~48MP) can hold
// several hundred MB of raw ImageData when decoded — downsampling large
// originals before pixel-level processing keeps memory bounded and avoids
// tab crashes (STEP43.5 rule: OOM/crash on a large real photo = failure).
// 4000px on the long edge still comfortably covers 1080-wide Carousel/Reels
// output and typical blog display sizes.
export const MAX_PROCESS_DIMENSION = 4000;
export const MAX_PREVIEW_DIMENSION = 1200;
