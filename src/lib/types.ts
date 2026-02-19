export interface Week {
  id: number;
  title: string;
  created_at: string;
  num_nights: number;
  servings: number;
  preferences: WeekPreferences;
  recipes?: Recipe[];
}

export interface LeftoverItem {
  name: string;
  amount: number;
  unit: "gr" | "ml" | "stuk";
}

export interface WeekPreferences {
  style?: string;
  budget?: string;
  healthy?: string;
  portions?: string;
  leftovers?: string | LeftoverItem[];
}

export interface Recipe {
  id: number;
  week_id: number | null;
  title: string;
  description: string;
  servings: number;
  prep_time: string;
  instructions: string;
  night_number: number;
  source_recipe_id: number | null;
  calories_per_serving: number;
  ingredients?: Ingredient[];
}

export interface Ingredient {
  id: number;
  recipe_id: number;
  name: string;
  quantity: string;
  is_staple: boolean;
  category: string;
  picnic_product?: PicnicProduct | null;
}

export interface PicnicProduct {
  id: number;
  ingredient_id: number;
  picnic_id: string;
  name: string;
  image_id: string;
  price: number;
  unit_quantity: string;
  quantity: number;
  added_to_cart: boolean;
}

export interface GeneratedRecipe {
  title: string;
  description: string;
  servings: number;
  prep_time: string;
  instructions: string;
  calories_per_serving: number;
  ingredients: GeneratedIngredient[];
}

export interface GeneratedIngredient {
  name: string;
  quantity: string;
  is_staple: boolean;
  category: string;
}

export interface CreateWeekRequest {
  title: string;
  num_nights: number;
  servings: number;
  preferences: WeekPreferences;
  reused_recipe_ids?: number[];
}

export interface Setting {
  key: string;
  value: string;
}

export interface FrequentItem {
  id: number;
  picnic_id: string;
  name: string;
  image_id: string;
  price: number;
  unit_quantity: string;
  quantity: number;
}
