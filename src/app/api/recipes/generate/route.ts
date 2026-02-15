import { NextResponse } from "next/server";
import { generateRecipes } from "@/lib/gemini";
import { WeekPreferences } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body: {
      num_recipes: number;
      servings: number;
      preferences: WeekPreferences;
      existing_titles?: string[];
    } = await request.json();

    const recipes = await generateRecipes(
      body.num_recipes,
      body.servings,
      body.preferences,
      body.existing_titles || []
    );

    return NextResponse.json(recipes);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
