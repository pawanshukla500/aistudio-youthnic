/**
 * The styling plan contract, shared by Studio, Planning and the analysis types.
 * It lives here rather than beside the editor so a feature's data contract does
 * not depend on the view that happens to render it.
 */
export type StylingPlan = {
  footwear: string;
  jewellery: string;
  ornaments: string;
  makeup: string;
  hair: string;
  stylingNotes: string;
  themeInterpretation: string;
};

/**
 * Fields the operator cleared stay cleared. The backend applies its own defaults
 * when the analysis leaves a field blank, and re-filling them here would put
 * generated text back into a box someone deliberately emptied.
 */
export function normalizePlan(value: unknown): StylingPlan {
  const plan = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    footwear: String(plan.footwear || ""),
    jewellery: String(plan.jewellery || ""),
    ornaments: String(plan.ornaments || ""),
    makeup: String(plan.makeup || ""),
    hair: String(plan.hair || ""),
    stylingNotes: String(plan.stylingNotes || ""),
    themeInterpretation: String(plan.themeInterpretation || ""),
  };
}
