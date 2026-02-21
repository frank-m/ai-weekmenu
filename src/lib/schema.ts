export const CREATE_TABLES = `
  CREATE TABLE IF NOT EXISTS weeks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    num_nights INTEGER NOT NULL,
    servings INTEGER NOT NULL,
    preferences TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_id INTEGER,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    servings INTEGER NOT NULL,
    prep_time TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    night_number INTEGER NOT NULL DEFAULT 0,
    source_recipe_id INTEGER,
    calories_per_serving INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    quantity TEXT NOT NULL DEFAULT '',
    is_staple INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS picnic_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL,
    picnic_id TEXT NOT NULL,
    name TEXT NOT NULL,
    image_id TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL DEFAULT 0,
    unit_quantity TEXT NOT NULL DEFAULT '',
    quantity INTEGER NOT NULL DEFAULT 1,
    added_to_cart INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS frequent_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    picnic_id TEXT NOT NULL,
    name TEXT NOT NULL,
    image_id TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL DEFAULT 0,
    unit_quantity TEXT NOT NULL DEFAULT '',
    quantity INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS staples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS sale_cache (
    picnic_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    image_id TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL DEFAULT 0,
    promo_label TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS known_promotions (
    promotion_id TEXT PRIMARY KEY,
    seed_picnic_id TEXT NOT NULL,
    label TEXT NOT NULL,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER,
    active INTEGER NOT NULL DEFAULT 1
  );
`;
