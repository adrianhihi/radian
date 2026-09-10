"use client";
import { useEffect } from "react";

// Reveal animation that CANNOT leave content invisible. `.reveal` elements
// start at opacity:0 and fade in when `.visible` is added. We add it shortly
// after each element appears in the DOM — no viewport/scroll geometry (which
// misbehaves for async content and in non-rendered contexts, and hid an
// earlier invisible-cards bug). Content still fades in with its stagger delay;
// it just fades on appear rather than on scroll.
export function useReveal() {
  useEffect(() => {
    const reveal = (el: HTMLElement) => {
      if (el.classList.contains("visible")) return;
      const delay = Number(el.dataset.revealDelay ?? 0);
      if (delay) window.setTimeout(() => el.classList.add("visible"), delay);
      else el.classList.add("visible");
    };
    const revealAll = () =>
      document.querySelectorAll<HTMLElement>(".reveal:not(.visible)").forEach(reveal);

    revealAll();
    // Catch elements added after mount (cards/tables from async chain/indexer fetches).
    const mo = new MutationObserver(() => revealAll());
    mo.observe(document.body, { childList: true, subtree: true });
    // Safety sweeps in case a commit lands between observer callbacks.
    const timers = [300, 1200, 3000].map((ms) => window.setTimeout(revealAll, ms));

    return () => {
      mo.disconnect();
      timers.forEach(window.clearTimeout);
    };
  }, []);
}
