import { describe, expect, it } from "vitest";
import { canAttemptImageCompression, imageUploadLimits, isSupportedUploadImage, uploadFileSizeValid } from "./image-upload";

function file(type: string, size: number): File {
  return new File([new Uint8Array(size)], "photo.jpg", { type });
}

describe("image upload preparation", () => {
  it("accepts supported image types only", () => {
    expect(isSupportedUploadImage(file("image/jpeg", 1))).toBe(true);
    expect(isSupportedUploadImage(file("image/png", 1))).toBe(true);
    expect(isSupportedUploadImage(file("application/pdf", 1))).toBe(false);
    expect(isSupportedUploadImage(file("image/jpeg", 0))).toBe(false);
  });

  it("allows large compressible images before the service upload limit", () => {
    expect(uploadFileSizeValid(file("image/jpeg", imageUploadLimits.maxUploadBytes + 1))).toBe(true);
    expect(canAttemptImageCompression(file("image/jpeg", imageUploadLimits.maxUploadBytes + 1))).toBe(true);
    expect(uploadFileSizeValid(file("image/gif", imageUploadLimits.maxUploadBytes + 1))).toBe(false);
    expect(uploadFileSizeValid(file("image/jpeg", imageUploadLimits.maxCompressSourceBytes + 1))).toBe(false);
  });
});
