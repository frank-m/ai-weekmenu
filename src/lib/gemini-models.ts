// Client-safe: imported by the Settings UI as well as lib/gemini.ts

export const DEFAULT_RECIPE_MODEL = "gemini-3.8-flash";
export const DEFAULT_MATCHING_MODEL = "gemini-3.5-flash-lite";

export const GEMINI_MODELS: { value: string; label: string }[] = [
  { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
];

/**
 * Models to fall back to, in order, when the configured one is overloaded.
 * Recipes degrade towards cheaper models; matching (already on the cheapest)
 * steps up instead.
 */
export const RECIPE_FALLBACK_CHAIN = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"];
export const MATCHING_FALLBACK_CHAIN = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash"];

export function modelLabel(model: string): string {
  return GEMINI_MODELS.find((m) => m.value === model)?.label ?? model;
}
