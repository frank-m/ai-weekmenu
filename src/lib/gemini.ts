import { GoogleGenAI, Type, Content, FunctionCall, ThinkingLevel, ApiError } from "@google/genai";
import {
  DEFAULT_RECIPE_MODEL,
  DEFAULT_MATCHING_MODEL,
  RECIPE_FALLBACK_CHAIN,
  MATCHING_FALLBACK_CHAIN,
  modelLabel,
} from "./gemini-models";
import type { ProgressReporter } from "./progress";
import { getSetting, getDb } from "./db";
import { GeneratedRecipe, WeekPreferences, LeftoverItem } from "./types";
import { rawSearch, searchProduct, delay, MatchedProduct, PicnicTwoFactorRequiredError } from "./picnic";
import { getStaples } from "./staples";
import { getExclusions } from "./exclusions";
import { getSeasonalProduce, SEASON_LABELS } from "./seasonal";

const DEALS_STALE_SECONDS = 48 * 60 * 60;

interface SaleCacheRow {
  name: string;
  promo_label: string;
  price: number;
}

function getCurrentDeals(): SaleCacheRow[] {
  try {
    const cutoff = Math.floor(Date.now() / 1000) - DEALS_STALE_SECONDS;
    return getDb()
      .prepare(
        "SELECT name, promo_label, price FROM sale_cache WHERE fetched_at > ? ORDER BY promo_label ASC, name ASC"
      )
      .all(cutoff) as SaleCacheRow[];
  } catch {
    return [];
  }
}

function getApiKey(): string {
  const key = getSetting("gemini_api_key") || process.env.GEMINI_API_KEY || "";
  if (!key) {
    throw new Error(
      "Gemini API key not configured. Set it in Settings or .env.local"
    );
  }
  return key;
}

export { DEFAULT_RECIPE_MODEL, DEFAULT_MATCHING_MODEL };

export interface GeminiCallOptions {
  /** Progress messages for the client's loading indicator */
  report?: ProgressReporter;
}

/** Why a call is worth retrying, or null when it isn't (bad key, bad request…). */
function retryReason(err: unknown): "busy" | "timed out" | null {
  if (err instanceof Error && (err.name === "AbortError" || /aborted|timed? ?out|DEADLINE_EXCEEDED/i.test(err.message))) {
    return "timed out";
  }
  if (err instanceof ApiError && [429, 500, 502, 503, 504].includes(err.status)) return "busy";
  if (err instanceof Error && /UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(err.message)) {
    return "busy";
  }
  return null;
}

/** Per-call retry policy: request timeouts grow with each attempt. */
export interface RetryPolicy {
  /** Timeout per attempt on the configured model, in ms; its length is the attempt count */
  primaryTimeouts: number[];
  /** Timeouts per attempt on each fallback model */
  fallbackTimeouts: number[];
}

// Recipe generation returns a lot of JSON (and thinks first), so it gets more time
export const RECIPE_RETRY: RetryPolicy = {
  primaryTimeouts: [90_000, 120_000, 150_000],
  fallbackTimeouts: [90_000, 120_000],
};
// One step of the matching tool loop is small
export const MATCHING_RETRY: RetryPolicy = {
  primaryTimeouts: [30_000, 45_000, 60_000],
  fallbackTimeouts: [30_000, 45_000],
};

const BACKOFF_BASE_MS = 1000;

/** Exponential backoff with jitter: ~1s, ~2s, ~4s… (±50%) so retries don't stampede. */
function backoffMs(retryNumber: number): number {
  const base = BACKOFF_BASE_MS * 2 ** (retryNumber - 1);
  return Math.round(base * (0.5 + Math.random()));
}

/**
 * Runs Gemini calls the way Google recommends for 503 "high demand" errors:
 * retry with exponential backoff and request timeouts that start short and grow.
 * The configured model gets the most attempts; after that it walks the fallback
 * chain and stays on the model that worked, so a multi-call loop (matching)
 * doesn't keep hitting the busy one. Every step is reported to the loading
 * indicator. (The SDK's own retryOptions retries silently and replaces Gemini's
 * error message with a generic one, so we don't use it.)
 */
/** "Gemini 3.8 Flash is busy" / "Gemini 3.8 Flash timed out" */
function describeFailure(model: string, why: "busy" | "timed out"): string {
  return why === "busy" ? `${modelLabel(model)} is busy` : `${modelLabel(model)} timed out`;
}

export class ModelRunner {
  private index = 0;
  private readonly models: string[];

  constructor(
    primary: string,
    fallbacks: string[],
    private readonly report: ProgressReporter,
    private readonly policy: RetryPolicy
  ) {
    this.models = [primary, ...fallbacks.filter((m) => m !== primary)];
  }

  get model(): string {
    return this.models[this.index];
  }

  async run<T>(fn: (model: string, timeoutMs: number) => Promise<T>): Promise<T> {
    for (;;) {
      const model = this.models[this.index];
      const timeouts = this.index === 0 ? this.policy.primaryTimeouts : this.policy.fallbackTimeouts;
      let reason: "busy" | "timed out" = "busy";
      for (let attempt = 1; attempt <= timeouts.length; attempt++) {
        try {
          return await fn(model, timeouts[attempt - 1]);
        } catch (err) {
          const why = retryReason(err);
          if (!why) throw err;
          reason = why;
          console.warn(
            `[gemini] ${model} ${why} (attempt ${attempt}/${timeouts.length}):`,
            err instanceof Error ? err.message : err
          );
          if (attempt < timeouts.length) {
            const wait = backoffMs(attempt);
            this.report(
              `${describeFailure(model, why)}, retrying in ${Math.max(1, Math.round(wait / 1000))}s (attempt ${attempt + 1} of ${timeouts.length})…`
            );
            await delay(wait);
          }
        }
      }
      const next = this.models[this.index + 1];
      if (!next) {
        throw new Error(
          "All Gemini models are busy or not responding right now. Spikes in demand are usually temporary, so please try again in a few minutes."
        );
      }
      this.report(`${describeFailure(model, reason)}, switching to ${modelLabel(next)}…`);
      this.index++;
    }
  }
}

// Recipe generation: one structured call where quality matters
function getModel(): string {
  return (
    getSetting("gemini_model") ||
    process.env.GEMINI_MODEL ||
    DEFAULT_RECIPE_MODEL
  );
}

// Ingredient → Picnic matching: a mechanical tool-calling loop that resends a
// growing history each iteration, so it dominates token usage — use a cheap model
function getMatchingModel(): string {
  return (
    getSetting("gemini_matching_model") ||
    process.env.GEMINI_MATCHING_MODEL ||
    DEFAULT_MATCHING_MODEL
  );
}

const recipeSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      description: { type: Type.STRING },
      servings: { type: Type.NUMBER },
      prep_time: { type: Type.STRING },
      instructions: { type: Type.STRING },
      calories_per_serving: { type: Type.NUMBER },
      ingredients: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            quantity: { type: Type.STRING },
            is_staple: { type: Type.BOOLEAN },
            category: { type: Type.STRING },
          },
          required: ["name", "quantity", "is_staple", "category"],
        },
      },
    },
    required: [
      "title",
      "description",
      "servings",
      "prep_time",
      "instructions",
      "calories_per_serving",
      "ingredients",
    ],
  },
};

export interface VarietyContext {
  /** Titles from recent weeks — soft avoid, keeps new menus from repeating. */
  recentTitles?: string[];
  /** Titles the user rated thumbs-down — hard avoid. */
  dislikedTitles?: string[];
  /** Titles already rejected in this regenerate session — hard avoid. */
  rejectedTitles?: string[];
}

/**
 * Collects variety context from the DB: recipe titles from the most recent
 * weeks and everything the user rated thumbs-down.
 */
export function getVarietyContext(excludeWeekId?: number): VarietyContext {
  try {
    const db = getDb();
    const recentTitles = (
      db
        .prepare(
          `SELECT DISTINCT r.title FROM recipes r
           JOIN weeks w ON r.week_id = w.id
           ${excludeWeekId ? "WHERE w.id != ?" : ""}
           ORDER BY w.created_at DESC, r.id DESC LIMIT 40`
        )
        .all(...(excludeWeekId ? [excludeWeekId] : [])) as { title: string }[]
    ).map((r) => r.title);
    const dislikedTitles = (
      db
        .prepare("SELECT DISTINCT title FROM recipes WHERE rating = -1")
        .all() as { title: string }[]
    ).map((r) => r.title);
    return { recentTitles, dislikedTitles };
  } catch {
    return {};
  }
}

function buildPrompt(
  numRecipes: number,
  servings: number,
  preferences: WeekPreferences,
  existingTitles: string[] = [],
  replacingTitle?: string,
  variety?: VarietyContext
): string {
  const calorieMap: Record<string, number> = {
    light: 400,
    normal: 600,
    large: 800,
  };
  const defaultCalories = parseInt(getSetting("default_calories") || "600") || 600;
  const calories = preferences.portions
    ? calorieMap[preferences.portions] || defaultCalories
    : defaultCalories;

  let prompt = `Generate ${numRecipes} dinner recipe(s) for ${servings} servings each.\n`;
  prompt += `Each recipe should target approximately ${calories} calories per serving.\n`;
  prompt += `Every recipe MUST include a substantial carbohydrate component (e.g. pasta, rijst, aardappelen, brood, noedels, couscous, quinoa, bulgur, gnocchi, or similar). Do not generate recipes that are only protein and vegetables.\n`;

  if (preferences.style) {
    prompt += `Cuisine style: ${preferences.style}\n`;
  }
  if (preferences.budget) {
    const budgetDescriptions: Record<string, string> = {
      budget:   "low — stay under €3 per person (non-staples only); use cheap cuts (gehakt, kipfilet, peulvruchten), frozen/canned veg, simple ingredients — no premium or specialty items",
      moderate: "medium — stay under €5 per person (non-staples only); everyday ingredients like kip, varkensvlees, pasta, seizoensgroenten — no premium cuts or specialty items",
      high:     "high — stay under €8 per person (non-staples only); good-quality everyday ingredients are fine (zalm, kip, kaas, vers vlees), practical home-cooking only — no luxury or gourmet items (e.g. no kreeft, wagyu, truffel, specialty restaurant ingredients)",
      premium:  "premium — stay under €12 per person (non-staples only); quality ingredients freely chosen (bijv. biefstuk, verse vis, premium kaas), practical home-cooking only — no elaborate gourmet techniques or rare specialty ingredients",
    };
    const budgetText = budgetDescriptions[preferences.budget] ?? preferences.budget;
    prompt += `Budget: ${budgetText}\n`;
    const excludeStaples = getSetting("exclude_staples_from_budget") !== "false";
    if (excludeStaples) {
      prompt += `Staple/pantry items (is_staple=true) are already at home and cost nothing — apply the budget constraint only to non-staple ingredients that need to be purchased.\n`;
    }
  }
  if (preferences.healthy) {
    prompt += `Healthiness: ${preferences.healthy}\n`;
  }

  if (preferences.leftovers) {
    let leftoversText: string;
    if (typeof preferences.leftovers === "string") {
      leftoversText = preferences.leftovers;
    } else {
      leftoversText = (preferences.leftovers as LeftoverItem[])
        .filter((l) => l.name.trim())
        .map((l) => `${l.amount}${l.unit} ${l.name}`)
        .join(", ");
    }
    if (leftoversText) {
      prompt += `\nThe user already has these leftover ingredients at home with the specified quantities: ${leftoversText}\n`;
      prompt += `Design recipes that use approximately these amounts. Still include these ingredients in the ingredients list with is_staple=true so the user can see them in the recipe.\n`;
      prompt += `Prioritize recipes that incorporate these ingredients. Not every recipe needs to use them, but try to use them all across the generated recipes.\n`;
    }
  }

  if (existingTitles.length > 0) {
    prompt += `\nAlready planned this week — do NOT repeat these, but note they may be from a different budget level; apply the budget constraint only to the new recipes you generate: ${existingTitles.join(", ")}\n`;
  }

  if (replacingTitle) {
    prompt += `\nYou are replacing the recipe "${replacingTitle}". Generate something completely different — not a variation of this dish.\n`;
  }

  if (variety?.rejectedTitles && variety.rejectedTitles.length > 0) {
    prompt += `\nThe user already rejected these suggestions — do NOT generate these dishes or close variations of them: ${variety.rejectedTitles.join(", ")}\n`;
  }

  if (variety?.dislikedTitles && variety.dislikedTitles.length > 0) {
    prompt += `\nThe user disliked these dishes — never generate them or anything very similar: ${variety.dislikedTitles.join(", ")}\n`;
  }

  if (variety?.recentTitles && variety.recentTitles.length > 0) {
    prompt += `\nRecently cooked in previous weeks — avoid repeating these and aim for clearly different dishes, proteins, and cuisines to keep menus varied: ${variety.recentTitles.join(", ")}\n`;
  }

  if (getSetting("deals_enabled") === "true") {
    const deals = getCurrentDeals();
    if (deals.length > 0) {
      prompt += `\nCurrently on sale at Picnic (prefer these ingredients when suitable for the menu):\n`;
      for (const d of deals) {
        prompt += `- ${d.name}: ${d.promo_label} (€${(d.price / 100).toFixed(2)})\n`;
      }
    }
  }

  if (preferences.seasonal !== false) {
    const { season, produce } = getSeasonalProduce();
    const label = SEASON_LABELS[season];
    prompt += `\nCurrently in season in the Netherlands (${label.name}, ${label.range}) — prefer these ingredients where suitable: ${produce.join(", ")}.\n`;
  }

  const exclusions = getExclusions();
  if (exclusions.length > 0) {
    prompt += `\nNever use these ingredients or dishes in any recipe: ${exclusions.join(", ")}. This is a strict requirement.\n`;
  }

  const staplesList = getStaples();
  prompt += `\nIMPORTANT: All ingredient names MUST be in Dutch (for Picnic grocery search).`;
  prompt += `\nFor each ingredient, set is_staple=true if it matches one of the user's staple pantry items: ${staplesList.join(", ")}. Set is_staple=false for all other recipe-specific items.`;
  prompt += `\nCategories should be one of: groenten, fruit, vlees, vis, zuivel, bakkerij, kruiden, overig.`;
  prompt += `\nInstructions MUST be numbered step-by-step (1. ... 2. ... etc). Each step should be short (1-2 sentences) with one clear action. Put each step on its own line.`;

  return prompt;
}

export async function generateRecipes(
  numRecipes: number,
  servings: number,
  preferences: WeekPreferences,
  existingTitles: string[] = [],
  replacingTitle?: string,
  variety?: VarietyContext,
  { report = () => {} }: GeminiCallOptions = {}
): Promise<GeneratedRecipe[]> {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const prompt = buildPrompt(numRecipes, servings, preferences, existingTitles, replacingTitle, variety);

  const runner = new ModelRunner(getModel(), RECIPE_FALLBACK_CHAIN, report, RECIPE_RETRY);
  report(numRecipes === 1 ? "Generating a new recipe…" : `Generating ${numRecipes} recipes…`);
  const response = await runner.run((model, timeout) =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        httpOptions: { timeout },
        responseMimeType: "application/json",
        responseSchema: recipeSchema,
        // Temperature left at the Gemini 3 default (1.0) — Google advises against
        // changing it; variety comes from the avoid-lists in the prompt instead
      },
    })
  );

  const text = response.text;
  if (!text) {
    throw new Error("Empty response from Gemini");
  }

  return JSON.parse(text) as GeneratedRecipe[];
}

const searchPicnicTool = {
  functionDeclarations: [
    {
      name: "search_picnic",
      description:
        "Search the Picnic grocery delivery catalog. Returns up to 5 matching products with id, name, price (cents), image_id, and unit_quantity.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
            description:
              "Short Dutch search query (1-2 words). Strip adjectives, prep methods, quantities.",
          },
        },
        required: ["query"],
      },
    },
  ],
};

export async function matchIngredientsToProducts(
  ingredients: { name: string; quantity: string }[],
  { report = () => {} }: GeminiCallOptions = {}
): Promise<Record<string, MatchedProduct | null>> {
  if (ingredients.length === 0) return {};
  const runner = new ModelRunner(getMatchingModel(), MATCHING_FALLBACK_CHAIN, report, MATCHING_RETRY);
  report(
    ingredients.length === 1
      ? "Finding a matching Picnic product…"
      : `Matching ${ingredients.length} ingredients to Picnic products…`
  );

  const ingredientNames = ingredients.map((i) => i.name);

  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const prompt = `You are matching Dutch recipe ingredients to Picnic grocery products.

For each ingredient below, use the search_picnic tool to find the best matching product.
- Simplify ingredient names for search: strip adjectives (verse, gehakte, geraspt), prep methods, and quantities
- Keep search queries short: 1-2 words in Dutch
- If no good match is found, try a different/simpler query
- You may search for multiple ingredients in parallel
- When multiple results differ only by package size, prefer the product whose unit_quantity most closely matches the needed quantity shown in parentheses
- Results are listed roughly in order of relevance; products the household bought before come first, so prefer those when they fit
- Among equally suitable products, prefer the lower unit_price (price per kg/l/piece) or one with a promo_label

Ingredients to match:
${ingredients.map((ing, i) => `${i + 1}. ${ing.name}${ing.quantity ? ` (need ${ing.quantity})` : ""}`).join("\n")}

When you have found the best match for each ingredient (or determined there is no match), respond with a JSON object mapping each ingredient name (exactly as listed above) to either a match object or null.

Also include "quantity": the integer number of units of this product needed to fulfill the recipe's required amount. Default to 1 when the product covers the required amount or when it cannot be determined.

Format:
{
  "ingredient name": {"picnic_id": "123", "name": "Product Name", "image_id": "abc", "price": 199, "unit_quantity": "500g", "quantity": 1},
  "other ingredient": null
}`;

  const history: Content[] = [{ role: "user", parts: [{ text: prompt }] }];

  const MAX_ITERATIONS = 50;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`[gemini] matchIngredientsToProducts iteration ${i + 1}`);

    const response = await runner.run((model, timeout) =>
      ai.models.generateContent({
        model,
        contents: history,
        config: {
          httpOptions: { timeout },
          tools: [searchPicnicTool],
          // Thinking tokens are billed as output; matching needs little reasoning
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      })
    );

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) {
      throw new Error("No response parts from Gemini");
    }

    // Add model response to history
    history.push({ role: "model", parts: candidate.content.parts });

    // Check for function calls
    const functionCalls = candidate.content.parts.filter(
      (p) => p.functionCall
    );

    if (functionCalls.length === 0) {
      // No function calls — model is done, parse text response
      const textPart = candidate.content.parts.find((p) => p.text);
      if (!textPart?.text) {
        throw new Error("No text response from Gemini after tool use");
      }

      console.log("[gemini] final response received, parsing results");
      return parseMatchResults(textPart.text, ingredientNames);
    }

    // Execute all function calls with rate limiting
    const functionResponses: Content["parts"] = [];
    for (const part of functionCalls) {
      const call = part.functionCall as FunctionCall;
      const query = (call.args as Record<string, string>)?.query || "";
      console.log(`[gemini] tool call: search_picnic("${query}")`);

      await delay(500);
      try {
        const results = await rawSearch(query);
        functionResponses.push({
          functionResponse: {
            name: call.name!,
            response: { results },
          },
        });
      } catch (err) {
        // Auth problems affect every search — abort instead of letting the
        // model "finish" with all-null matches that look like a success
        if (err instanceof PicnicTwoFactorRequiredError) throw err;
        functionResponses.push({
          functionResponse: {
            name: call.name!,
            response: { error: String(err) },
          },
        });
      }
    }

    history.push({ role: "user", parts: functionResponses });
  }

  throw new Error("matchIngredientsToProducts exceeded max iterations");
}

/**
 * Match ingredients to Picnic products, then direct-search any that the LLM
 * matcher left unmatched. The agentic matcher often "succeeds" but returns null
 * for some ingredients (over-simplified query, gave up early, or a JSON key that
 * doesn't exactly match the ingredient name) — a plain search on the ingredient
 * name usually finds those, which is exactly what the manual search box does.
 */
export async function matchIngredientsWithFallback(
  ingredients: { name: string; quantity: string }[],
  options: GeminiCallOptions = {}
): Promise<Record<string, MatchedProduct | null>> {
  const report = options.report ?? (() => {});
  let productMap: Record<string, MatchedProduct | null> = {};
  try {
    productMap = await matchIngredientsToProducts(ingredients, options);
  } catch (err) {
    // Auth problems affect every search — surface, don't paper over.
    if (err instanceof PicnicTwoFactorRequiredError) throw err;
    console.error("[gemini] LLM matching failed, falling back to direct search:", err);
    productMap = {};
  }

  const unmatched = ingredients.filter(({ name }) => !productMap[name]).length;
  if (unmatched > 0) {
    report(
      unmatched === 1
        ? "Searching Picnic directly for 1 unmatched ingredient…"
        : `Searching Picnic directly for ${unmatched} unmatched ingredients…`
    );
  }
  for (const { name } of ingredients) {
    if (productMap[name]) continue;
    await delay(500);
    try {
      const product = await searchProduct(name);
      // First search result, unvetted — flag it so the UI can ask the user to check
      productMap[name] = product ? { ...product, auto_matched: true } : null;
    } catch (searchErr) {
      if (searchErr instanceof PicnicTwoFactorRequiredError) throw searchErr;
      productMap[name] = null;
    }
  }

  return productMap;
}

function parseMatchResults(
  text: string,
  ingredientNames: string[]
): Record<string, MatchedProduct | null> {
  // Extract JSON from response (may be wrapped in markdown code block)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  const parsed = JSON.parse(jsonMatch[1]!.trim());

  const result: Record<string, MatchedProduct | null> = {};
  for (const name of ingredientNames) {
    const match = parsed[name];
    if (match && match.picnic_id) {
      result[name] = {
        picnic_id: String(match.picnic_id),
        name: match.name || "",
        image_id: match.image_id || "",
        price: typeof match.price === "number" ? match.price : parseInt(match.price) || 0,
        unit_quantity: match.unit_quantity || "",
        quantity: (typeof match.quantity === "number" && match.quantity >= 1) ? Math.round(match.quantity) : 1,
      };
    } else {
      result[name] = null;
    }
  }
  return result;
}

export async function testApiKey(apiKey: string): Promise<boolean> {
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: DEFAULT_MATCHING_MODEL,
      contents: "Say hello in one word.",
    });
    return !!response.text;
  } catch {
    return false;
  }
}
