// Short-lived progress messages for long-running requests (recipe generation,
// product matching), polled by the client's loading indicators via
// GET /api/progress/[id]. The client picks a random id and sends it in the
// x-progress-id header.
//
// Kept on globalThis: Next bundles each route separately, so a module-level Map
// would not be shared between the route doing the work and the polling route.

export type ProgressReporter = (message: string) => void;

interface Entry {
  message: string;
  updatedAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const g = globalThis as typeof globalThis & { __weekmenuProgress?: Map<string, Entry> };
const store: Map<string, Entry> = (g.__weekmenuProgress ??= new Map());

function prune(now: number) {
  Array.from(store.entries()).forEach(([id, entry]) => {
    if (now - entry.updatedAt > TTL_MS) store.delete(id);
  });
}

const VALID_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Reporter for the request's x-progress-id header; a no-op without one. */
export function progressReporter(request: Request): ProgressReporter {
  const id = request.headers.get("x-progress-id");
  if (!id || !VALID_ID.test(id)) return () => {};
  return (message: string) => {
    const now = Date.now();
    prune(now);
    store.set(id, { message, updatedAt: now });
    console.log(`[progress] ${message}`);
  };
}

export function getProgress(id: string): string | null {
  return store.get(id)?.message ?? null;
}
