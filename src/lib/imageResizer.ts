// Product references are the only stored copy and feed both analysis and image
// generation, so keep enough resolution for weave, zari and small motifs.
export const REFERENCE_MAX_DIMENSION = 2048;
export const REFERENCE_JPEG_QUALITY = 0.92;

export async function resizeImageFile(
  file: File,
  maxDimension: number = REFERENCE_MAX_DIMENSION,
  quality: number = REFERENCE_JPEG_QUALITY
): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return file;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const isJpeg = file.type === "image/jpeg" || file.type === "image/jpg";

        // If it's already a JPEG, under maxDimension, and smaller than 400KB, keep it.
        if (isJpeg && width <= maxDimension && height <= maxDimension && file.size <= 400 * 1024) {
          resolve(file);
          return;
        }

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }

        // Fill background with white to avoid black backgrounds for transparent PNGs/WebPs
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, width, height);
        // High-quality smoothing avoids aliasing and moire on fine prints when downscaling.
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            const normalizedName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
            const newFile = new File([blob], normalizedName, {
              type: "image/jpeg",
              lastModified: Date.now(),
            });
            resolve(newFile);
          },
          "image/jpeg",
          quality
        );
      };
      img.onerror = () => resolve(file);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}
