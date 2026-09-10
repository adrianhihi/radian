"use client";
import { useEffect } from "react";

// Scroll-reveal that CANNOT leave content invisible. Elements with `.reveal`
// start at opacity:0 and get `.visible` (which fades them in) once they're in
// view. Because token cards load asynchronously from chain/indexer, we can't
// rely on a one-shot observer at mount — so we sweep on scroll + on an
// interval, and hard-reveal everything after a grace period as a safety net.
export function useReveal() {
  useEffect(() => {
    const reveal = (el: HTMLElement) => {
      const delay = Number(el.dataset.revealDelay ?? 0);
      if (delay) window.setTimeout(() => el.classList.add("visible"), delay);
      else el.classList.add("visible");
    };
    const inView = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight * 1.05 && r.bottom > -40;
    };
    const sweep = () =>
      document.querySelectorAll<HTMLElement>(".reveal:not(.visible)").forEach((el) => {
        if (inView(el)) reveal(el);
      });

    sweep();
    const onScroll = () => sweep();
    window.addEventListener("scroll", onScroll, { passive: true });
    // catch async-loaded content (cards, tables) that appears after mount
    const iv = window.setInterval(sweep, 350);
    // hard safety net: after 3.5s nothing stays hidden, whatever went wrong
    const fallback = window.setTimeout(() => {
      document.querySelectorAll<HTMLElement>(".reveal:not(.visible)").forEach((el) => el.classList.add("visible"));
      window.clearInterval(iv);
    }, 3500);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearInterval(iv);
      window.clearTimeout(fallback);
    };
  }, []);
}
