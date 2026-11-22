const MODEL_LABELS: Record<string, string> = {
  "muse-spark-1.2-contributor": "Meta Muse Spark 1.2",
  "muse-spark-1.3-contributor": "Meta Muse Spark 1.3",
  "muse-spark-1.3": "Meta Muse Spark 1.3",
  "muse-spark-1.2": "Meta Muse Spark 1.2",
  "glm-5.3-flash": "Z.ai GLM 5.3 Flash",
  "glm-5.3-flashx": "Z.ai GLM 5.3 FlashX",
  "gpt-6.1-terra": "GPT 6.1 Terra",
  "gpt-5.6-luna": "GPT 5.6 Luna",
  "gpt-5.6-terra": "GPT 5.6 Terra",
  "gpt-5.6-sol": "GPT 5.6 Sol",
  "gemini-3.8-flash": "Gemini 3.8 Flash",
  "gemini-3.6-flash": "Gemini 3.6 Flash",
  "qwen3.8-max": "Qwen 3.8 Max",
  "gpt-image-2.6-sunburst": "GPT Image 2.6 Sunburst",
  "gpt-image-2.6-flare": "GPT Image 2.6 Flare",
  "gpt-image-2.6": "GPT Image 2.6",
  "gpt-image-2.5-flare-2026-09-08": "GPT Image 2.5 Flare",
  "gpt-image-2.5-flare": "GPT Image 2.5 Flare",
  "gpt-image-2.5-sunburst": "GPT Image 2.5 Sunburst",
  "gpt-image-2": "GPT Image 2",
  "reve-2.1-image": "Reve 2.1 Image",
};

/** A model id in words, e.g. "muse-spark-1.3-contributor" -> "Meta Muse Spark 1.3". */
export function formatModelName(model?: string | null): string {
  if (!model) return "Default Model";
  return MODEL_LABELS[model] || model.split("-").map((s) => (s ? s[0].toUpperCase() + s.slice(1) : "")).join(" ");
}
