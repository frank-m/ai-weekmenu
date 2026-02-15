import { GoogleGenAI, Type, Content, FunctionCall } from "@google/genai";
import { getSetting } from "./db";
import { GeneratedRecipe, WeekPreferences, LeftoverItem } from "./types";
import { rawSearch, delay, MatchedProduct } from "./picnic";

function getApiKey(): string {
  const key = getSetting("gemini_api_key") || process.env.GEMINI_API_KEY || "";
  if (!key) {
    throw new Error(
      "Gemini API key not configured. Set it in Settings or .env.local"
    );
  }
  return key;
}

function getModel(): string {
  return (
    getSetting("gemini_model") ||
    process.env.GEMINI_MODEL ||
    "gemini-2.5-flash"
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
      "ingredients",
    ],
  },
};

function buildPrompt(
  numRecipes: number,
  servings: number,
  preferences: WeekPreferences,
  existingTitles: string[] = []
): string {
  let prompt = `Generate ${numRecipes} dinner recipe(s) for ${servings} servings each.\n`;
  prompt += `Each recipe should target approximately 600 calories per serving with a balanced mix of protein, carbohydrates, and healthy fats.\n`;

  if (preferences.style) {
    prompt += `Cuisine style: ${preferences.style}\n`;
  }
  if (preferences.budget) {
    prompt += `Budget level: ${preferences.budget}\n`;
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
    prompt += `\nAlready planned this week (do NOT repeat): ${existingTitles.join(", ")}\n`;
  }

  prompt += `\nIMPORTANT: All ingredient names MUST be in Dutch (for Picnic grocery search).`;
  prompt += `\nFor each ingredient, set is_staple=true for basic pantry items (salt, pepper, oil, butter, garlic, onions, sugar, flour, etc.) and is_staple=false for recipe-specific items.`;
  prompt += `\nCategories should be one of: groenten, fruit, vlees, vis, zuivel, bakkerij, kruiden, overig.`;
  prompt += `\nInstructions MUST be numbered step-by-step (1. ... 2. ... etc). Each step should be short (1-2 sentences) with one clear action. Put each step on its own line.`;

  return prompt;
}

export async function generateRecipes(
  numRecipes: number,
  servings: number,
  preferences: WeekPreferences,
  existingTitles: string[] = []
): Promise<GeneratedRecipe[]> {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const prompt = buildPrompt(numRecipes, servings, preferences, existingTitles);

  const response = await ai.models.generateContent({
    model: getModel(),
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: recipeSchema,
    },
  });

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
  ingredientNames: string[]
): Promise<Record<string, MatchedProduct | null>> {
  if (ingredientNames.length === 0) return {};

  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const prompt = `You are matching Dutch recipe ingredients to Picnic grocery products.

For each ingredient below, use the search_picnic tool to find the best matching product.
- Simplify ingredient names for search: strip adjectives (verse, gehakte, geraspt), prep methods, and quantities
- Keep search queries short: 1-2 words in Dutch
- If no good match is found, try a different/simpler query
- You may search for multiple ingredients in parallel

Ingredients to match:
${ingredientNames.map((name, i) => `${i + 1}. ${name}`).join("\n")}

When you have found the best match for each ingredient (or determined there is no match), respond with a JSON object mapping each ingredient name (exactly as listed above) to either a match object or null.

Format:
{
  "ingredient name": {"picnic_id": "123", "name": "Product Name", "image_id": "abc", "price": 199, "unit_quantity": "500g"},
  "other ingredient": null
}`;

  const history: Content[] = [{ role: "user", parts: [{ text: prompt }] }];

  const MAX_ITERATIONS = 50;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`[gemini] matchIngredientsToProducts iteration ${i + 1}`);

    const response = await ai.models.generateContent({
      model: getModel(),
      contents: history,
      config: {
        tools: [searchPicnicTool],
      },
    });

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

      await delay(250);
      try {
        const results = await rawSearch(query);
        functionResponses.push({
          functionResponse: {
            name: call.name!,
            response: { results },
          },
        });
      } catch (err) {
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
      model: "gemini-2.5-flash",
      contents: "Say hello in one word.",
    });
    return !!response.text;
  } catch {
    return false;
  }
}
