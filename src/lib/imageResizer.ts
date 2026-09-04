export async function resizeImageFile(file: File, maxDimension: number): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return file;

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width <= maxDimension && height <= maxDimension) {
          resolve(file); // No need to resize
          return;
        }
        
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
        
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }
        
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            // Preserve the original file name and type (or force high-quality jpeg if preferred)
            const newFile = new File([blob], file.name, {
              type: file.type === "image/png" ? "image/png" : "image/jpeg",
              lastModified: Date.now(),
            });
            resolve(newFile);
          },
          file.type === "image/png" ? "image/png" : "image/jpeg",
          0.90
        );
      };
      img.onerror = () => resolve(file); // fallback to original if loading fails
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}
