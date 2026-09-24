"use client";

// A site-wide "hide amounts" switch for screenshots and screen sharing. One store,
// so the portfolio page and the nav agree (hiding on the page while the header still
// shows the total leaks it). The mask is fixed-length: a digit count would give the
// magnitude away. Other tabs follow through the storage event.
import { useSyncExternalStore } from "react";
import { readLS, writeLS } from "./storage";

const KEY = "radian.hideAmounts";
const EVENT = "radian:hide-amounts";
export const MASK = "••••";

let memory = false; // fallback when storage is unavailable
const read = (): boolean => {
  const v = readLS(KEY);
  return v == null ? memory : v === "1";
};

export function setHideAmounts(hidden: boolean) {
  memory = hidden;
  writeLS(KEY, hidden ? "1" : "0"); // refused (private mode): this session only, and the Shell says so
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useHideAmounts(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
