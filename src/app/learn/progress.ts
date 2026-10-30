"use client";

/**
 * Which lessons this browser has finished. Local only: a lesson is reading,
 * not play, so it earns nothing and needs no server.
 */
import { useEffect, useState } from "react";
import { safeLocal } from "../shared";

const KEY = "lc.learned";

function read(): string[] {
  try {
    const v = JSON.parse(safeLocal.get(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function useLearned() {
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => setDone(read()), []);
  const mark = (slug: string) => {
    const next = [...new Set([...read(), slug])];
    safeLocal.set(KEY, JSON.stringify(next));
    setDone(next);
  };
  return { done, mark };
}
