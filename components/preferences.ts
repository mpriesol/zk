import { useEffect, useState } from "react";

/** UI choices only. No account, entitlement or private content is stored here. */
export function usePreference<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
) {
  const read = (): T => {
    try {
      const value = localStorage.getItem(key) as T;
      return allowed.includes(value) ? value : fallback;
    } catch {
      return fallback;
    }
  };
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    setValue(read());
  }, [key]);
  const save = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      /* Private browsing remains usable. */
    }
  };
  return [value, save] as const;
}
