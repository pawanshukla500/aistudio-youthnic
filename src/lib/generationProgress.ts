export type GenerationProgressInput = {
  totalPoses?: number | null;
  completedPoses?: number | null;
  failedPoses?: number | null;
};

export type GenerationDeliveryProgress = {
  totalPoses: number;
  imagesStored: number;
  failedPoses: number;
  resolvedPoses: number;
  deliveredPercent: number;
  resolvedPercent: number;
};

function wholeNumber(value: number | null | undefined) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

// A failed pose is resolved work, but it is never a stored image. Keeping those
// concepts separate stops an all-failed job from looking like a 100% download.
export function generationDeliveryProgress(input: GenerationProgressInput): GenerationDeliveryProgress {
  const totalPoses = Math.max(1, wholeNumber(input.totalPoses));
  const imagesStored = Math.min(totalPoses, wholeNumber(input.completedPoses));
  const failedPoses = Math.min(totalPoses - imagesStored, wholeNumber(input.failedPoses));
  const resolvedPoses = imagesStored + failedPoses;
  return {
    totalPoses,
    imagesStored,
    failedPoses,
    resolvedPoses,
    deliveredPercent: Math.round((imagesStored / totalPoses) * 100),
    resolvedPercent: Math.round((resolvedPoses / totalPoses) * 100),
  };
}
