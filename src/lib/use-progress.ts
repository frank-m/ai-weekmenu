"use client";

import { useEffect, useState } from "react";

/** A fresh id to send as the x-progress-id header of a long-running request. */
export function newProgressId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Polls the server's progress message for `id` while it is set. */
export function useProgress(id: string | null, intervalMs = 1000): string | null {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setMessage(null);
    if (!id) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/progress/${id}`);
        const data = await res.json();
        if (!cancelled && data.message) setMessage(data.message);
      } catch {
        // Progress is best-effort; the request itself reports errors
      }
    };
    const timer = setInterval(poll, intervalMs);
    poll();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, intervalMs]);

  return message;
}
