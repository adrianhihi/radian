"use client";

// The landing at "/": a sticky stage inside a scroll container several
// viewports tall. Scroll progress drives the frame of the cave sequence, the
// three copy stages and the glass cards. No React state on the hot path: a
// rAF loop writes opacity / transform / --reveal straight to the DOM.
import Link from "next/link";
import { useEffect, useRef, type CSSProperties } from "react";
import "./landing.css";
import { CaveScene, FrameStore } from "./scene";
import { Dissolve } from "./dissolve";
import { SCENE_HEIGHT_VH, STAGES, bodyReveal, clamp, stageStyle, wordReveal, type StageWindow } from "@/lib/landing";
import { useT } from "@/components/LangProvider";
import { isTestnet, useNetwork } from "@/lib/networks";
import { BrandMark, DARK_PALETTE } from "@/components/shell/BrandMark";

/** One title line split into words that reveal one by one (a Chinese line without spaces reveals as one unit). */
function Line({ text, accent = false, offset = 0 }: { text: string; accent?: boolean; offset?: number }) {
  const words = text.split(" ");
  return (
    <span className={accent ? "l-line l-line-accent" : "l-line"}>
      {words.map((w, i) => (
        <span key={`${w}-${i}`} className="l-word" style={{ "--word-index": offset + i } as CSSProperties}>
          {i < words.length - 1 ? `${w} ` : w}
        </span>
      ))}
    </span>
  );
}

interface Bound {
  el: HTMLElement;
  words: HTMLElement[];
  body: HTMLElement | null;
}

function bind(el: HTMLElement | null): Bound | null {
  if (!el) return null;
  return { el, words: Array.from(el.querySelectorAll<HTMLElement>(".l-word")), body: el.querySelector<HTMLElement>(".l-body") };
}

function paint(b: Bound | null, w: StageWindow, p: number) {
  if (!b) return;
  const s = stageStyle(p, w);
  b.el.style.opacity = String(s.opacity);
  b.el.style.transform = `translate3d(0, ${s.y}px, 0)`;
  b.el.style.visibility = s.visible ? "visible" : "hidden";
  if (!w.enter) return; // the hero's words are CSS-animated on load
  for (let i = 0; i < b.words.length; i += 1) b.words[i].style.setProperty("--reveal", String(wordReveal(p, w, i, b.words.length)));
  b.body?.style.setProperty("--body-reveal", String(bodyReveal(p, w)));
}

export function Landing() {
  const t = useT();
  const net = useNetwork();
  const live = net.live && !isTestnet(net);

  const rootRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const introCanvasRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const midRef = useRef<HTMLElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const finalRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const sceneEl = sceneRef.current;
    const canvas = canvasRef.current;
    if (!root || !sceneEl || !canvas) return;

    let cancelled = false;
    let raf = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stages = { hero: bind(heroRef.current), mid: bind(midRef.current), cards: bind(cardsRef.current), final: bind(finalRef.current) };

    const frames = new FrameStore();
    let scene: CaveScene | null = null;
    try {
      scene = new CaveScene(canvas, frames, reduced);
    } catch {
      canvas.style.display = "none"; // no WebGL: the gradient ground and the copy still read
    }

    let target = 0;
    let smoothed = 0;
    const readProgress = () => {
      const travel = sceneEl.offsetHeight - window.innerHeight;
      target = clamp(-sceneEl.getBoundingClientRect().top / Math.max(1, travel));
    };
    const onPointer = (e: PointerEvent) => scene?.setPointer((e.clientX / window.innerWidth - 0.5) * 2, (0.5 - e.clientY / window.innerHeight) * 2);
    const onLeave = () => scene?.setPointer(0, 0);
    const onResize = () => {
      scene?.resize();
      readProgress();
    };
    const tick = () => {
      smoothed = reduced ? target : smoothed + (target - smoothed) * 0.09;
      if (scene) void frames.load(scene.frameFor(smoothed)); // the frame under the reader loads first
      scene?.render(smoothed);
      paint(stages.hero, STAGES.hero, smoothed);
      paint(stages.mid, STAGES.mid, smoothed);
      paint(stages.cards, STAGES.cards, smoothed);
      paint(stages.final, STAGES.final, smoothed);
      raf = requestAnimationFrame(tick);
    };

    readProgress();
    window.addEventListener("scroll", readProgress, { passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(tick);

    // intro overlay: the bar measures real readiness (9 frames decoded + fonts)
    let dissolve: Dissolve | null = null;
    const intro = introRef.current;
    const finish = () => {
      if (cancelled) return;
      intro?.classList.add("l-intro-gone");
      root.classList.add("l-ready");
      dissolve?.dispose();
      dissolve = null;
    };
    const twoFrames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    void (async () => {
      try {
        if (introCanvasRef.current) dissolve = new Dissolve(introCanvasRef.current);
      } catch {
        dissolve = null;
      }
      let shown = 0;
      let pump = requestAnimationFrame(function loop() {
        shown = Math.max(shown, frames.primeRatio); // only ever forward
        barRef.current?.style.setProperty("transform", `scaleX(${shown})`);
        if (countRef.current) countRef.current.textContent = String(Math.round(shown * 100));
        pump = requestAnimationFrame(loop);
      });
      // allSettled: a failed frame must not leave the overlay up forever
      await Promise.allSettled([document.fonts?.ready ?? Promise.resolve(), frames.prime()]);
      cancelAnimationFrame(pump);
      if (cancelled) return;
      scene?.resize();
      scene?.render(0); // paint the first frame before the overlay melts
      await twoFrames();
      if (cancelled) return;
      barRef.current?.style.setProperty("transform", "scaleX(1)");
      if (countRef.current) countRef.current.textContent = "100";
      await new Promise((r) => setTimeout(r, 200));
      if (cancelled) return;
      intro?.classList.add("l-intro-dismissing");
      if (dissolve && !reduced) await dissolve.play(950);
      finish();
      frames.backfill(); // the remaining frames, after the opening has had the bandwidth
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", readProgress);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("pointerleave", onLeave);
      scene?.dispose();
      frames.dispose();
      dissolve?.dispose();
    };
  }, []);

  const heroA = t("landing.heroA");
  const midA = t("landing.midA");
  const finalA = t("landing.finalA");

  return (
    <>
      <div ref={rootRef}>
        <main ref={sceneRef} className="l-scene" style={{ "--l-scene-height": `${SCENE_HEIGHT_VH}vh` } as CSSProperties}>
          <div className="l-stage">
            <canvas ref={canvasRef} className="l-canvas" aria-label={t("landing.sceneAria")} role="img" />
            <div className="l-shade" />

            <header className="l-header">
              <Link href="/" className="l-brand" aria-label={t("shell.brandAria")}>
                <BrandMark size={30} palette={DARK_PALETTE} />
                <span className="l-wordmark">Radian</span>
              </Link>
              <div className="l-actions">
                <span className="l-badge">{live ? t("landing.badgeLive", { chain: net.chainName }) : /testnet/i.test(net.chainName) ? net.chainName : t("landing.badgeTest", { chain: net.chainName })}</span>
                <nav className="l-pill" aria-label={t("shell.navAria")}>
                  <Link href="/explore">{t("nav.explore")}</Link>
                  <Link href="/docs">{t("nav.learn")}</Link>
                  <Link href="/terms">{t("landing.navRisk")}</Link>
                </nav>
                <Link href="/explore" className="l-enter" data-cursor-hot="">
                  {t("landing.enter")}
                </Link>
              </div>
            </header>

            <div className="l-content">
              <section ref={heroRef} className="l-state l-hero">
                <h1 className="l-title">
                  <Line text={heroA} />
                  <Line text={t("landing.heroB")} accent offset={heroA.split(" ").length} />
                </h1>
                <div>
                  <p className="l-body">{t("landing.heroBody")}</p>
                  <Link href="/explore" className="l-cta" data-cursor-hot="">
                    {t("landing.heroCta")}
                    <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </section>

              <section ref={midRef} className="l-state">
                <h2 className="l-title">
                  <Line text={midA} />
                  <Line text={t("landing.midB")} accent offset={midA.split(" ").length} />
                </h2>
                <p className="l-body">{t("landing.midBody")}</p>
              </section>

              <div ref={cardsRef} className="l-cards">
                <article className="l-card l-card-left">
                  <p className="l-card-kicker">01</p>
                  <h2>{t("landing.card1Title")}</h2>
                  <p>{t("landing.card1Body")}</p>
                </article>
                <article className="l-card l-card-right">
                  <p className="l-card-kicker">02</p>
                  <h2>{t("landing.card2Title")}</h2>
                  <p>{t("landing.card2Body")}</p>
                </article>
              </div>

              <section ref={finalRef} className="l-state">
                <h2 className="l-title">
                  <Line text={finalA} />
                  <Line text={t("landing.finalB")} accent offset={finalA.split(" ").length} />
                </h2>
                <div>
                  <p className="l-body">{t("landing.finalBody")}</p>
                  <Link href="/explore" className="l-cta" data-cursor-hot="">
                    {t("landing.finalCta")}
                    <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </section>
            </div>

            <div className="l-hint" aria-hidden="true">
              <i />
              {t("landing.scrollHint")}
            </div>

            <div ref={introRef} className="l-intro" role="status" aria-label={t("landing.introAria")}>
              <div className="l-frost" aria-hidden="true" />
              <canvas ref={introCanvasRef} className="l-intro-canvas" aria-hidden="true" />
              <div className="l-intro-ui">
                <span className="l-wordmark">Radian</span>
                <p className="l-intro-count" aria-hidden="true">
                  <span ref={countRef}>0</span>%
                </p>
                <div className="l-intro-track">
                  <div ref={barRef} className="l-intro-bar" />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
      <LandingCursor />
    </>
  );
}

/** Custom cursor on fine-pointer devices; the ring grows over links. */
function LandingCursor() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let cx = x;
    let cy = y;
    let raf = 0;
    const move = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      el.classList.add("l-cursor-on");
      const hot = (e.target as Element | null)?.closest?.("a, button, [data-cursor-hot]");
      el.classList.toggle("l-cursor-hot", Boolean(hot));
    };
    const out = () => el.classList.remove("l-cursor-on");
    const tick = () => {
      cx += (x - cx) * 0.2;
      cy += (y - cy) * 0.2;
      el.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("mouseleave", out);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      document.removeEventListener("mouseleave", out);
    };
  }, []);
  return (
    <div ref={ref} className="l-cursor" aria-hidden="true">
      <span className="l-cursor-ring" />
      <span className="l-cursor-dot" />
    </div>
  );
}
