"use client";

// A clock that ticks every `everyMs`, for "read N min ago" labels. Starts at mount so
// the server and the first client frame agree.
import { useEffect, useState } from "react";

export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
