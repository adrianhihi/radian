"use client";

// A PNG of a portfolio's mix — percentages only, never amounts — for sharing.
// Drawn on a canvas in the browser; offered through the share sheet where one
// exists, saved as a file otherwise.

export type ShareRow = { symbol: string; share: number; color: string };

export async function shareMixImage(rows: ShareRow[], title: string, footer = "radian"): Promise<"shared" | "saved" | "failed"> {
  const top = rows.slice(0, 10);
  const W = 1080;
  const H = 260 + top.length * 70;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return "failed";
  ctx.fillStyle = "#14100b";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#f6efe4";
  ctx.font = "600 44px system-ui, sans-serif";
  ctx.fillText(title, 64, 110);
  // composition bar
  let x = 64;
  const barW = W - 128;
  for (const r of rows) {
    const w = Math.max(2, r.share * barW - 4);
    ctx.fillStyle = r.color;
    ctx.fillRect(x, 150, w, 18);
    x += r.share * barW;
  }
  // rows
  top.forEach((r, i) => {
    const y = 240 + i * 70;
    ctx.fillStyle = r.color;
    ctx.beginPath();
    ctx.arc(76, y - 10, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f6efe4";
    ctx.font = "600 34px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`$${r.symbol}`, 108, y);
    ctx.font = "500 34px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${(r.share * 100).toFixed(1)}%`, W - 64, y);
  });
  ctx.textAlign = "left";
  ctx.fillStyle = "#9a8a76";
  ctx.font = "400 24px system-ui, sans-serif";
  ctx.fillText(footer, 64, H - 40);

  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
  if (!blob) return "failed";
  const file = new File([blob], "radian-mix.png", { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch {
      /* declined: fall through to a download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "radian-mix.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "saved";
}
