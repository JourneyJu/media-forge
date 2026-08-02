const maxUploadBytes = 10 * 1024 * 1024;
const maxCompressSourceBytes = 30 * 1024 * 1024;
const compressThresholdBytes = 1.5 * 1024 * 1024;
const maxImageDimension = 1800;
const jpegQuality = 0.82;

const compressibleTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function isSupportedUploadImage(file: File): boolean {
  return ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) && file.size > 0;
}

export function canAttemptImageCompression(file: File): boolean {
  return compressibleTypes.has(file.type) && file.size > compressThresholdBytes && file.size <= maxCompressSourceBytes;
}

export function uploadFileSizeValid(file: File): boolean {
  return file.size <= maxUploadBytes || canAttemptImageCompression(file);
}

function compressedFileName(name: string): string {
  const baseName = name.trim() || "image";
  return baseName.replace(/\.[^.]+$/u, "") + ".jpg";
}

async function blobFromCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("IMAGE_COMPRESSION_FAILED"));
    }, "image/jpeg", jpegQuality);
  });
}

export async function prepareImageForUpload(file: File): Promise<File> {
  if (!canAttemptImageCompression(file)) return file;

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxImageDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await blobFromCanvas(canvas);
    if (blob.size <= 0 || blob.size >= file.size || blob.size > maxUploadBytes) return file;
    return new File([blob], compressedFileName(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified
    });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}

export const imageUploadLimits = {
  maxUploadBytes,
  maxCompressSourceBytes
};
