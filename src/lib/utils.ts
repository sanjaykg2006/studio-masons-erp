import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names safely (dedupes conflicting utilities).
 * Used by every UI primitive — the one place class merging lives.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
