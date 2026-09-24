// The 404 is a server component with both languages written in: no store, no
// dictionary, no wallet, so it renders even when routing itself is what broke.
// A 7×18 pixel grid spells "404"; one lit brand cell is the page you were
// looking for and did not find.
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Not found · Radian", robots: { index: false, follow: false } };

// ' ' gap · '.' dim cell · 'O' stroke · 'X' the one brand cell
const GRID = [
  "O...O  OOOO  O...O",
  "O...O  O..O  O...O",
  "O...O  O..O  O...O",
  "OOOOO  O..O  OOOOO",
  "....O  O..O  ....O",
  "....O  O..O  ....O",
  "....O  OOOO  ....X",
];

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-10 px-4 py-16 font-sans">
      <div aria-hidden="true" className="grid gap-[5px] nav:gap-3" style={{ gridTemplateColumns: `repeat(${GRID[0].length}, auto)` }}>
        {GRID.flatMap((row, y) =>
          [...row].map((c, x) => (
            <span
              key={`${x}-${y}`}
              className={`size-[14px] rounded-[4px] nav:size-8 nav:rounded-[10px] ${
                c === " " ? "" : c === "." ? "bg-glass-2" : c === "O" ? "bg-ink-3 opacity-60" : "bg-brand shadow-[0_0_18px_var(--brand)]"
              }`}
            />
          )),
        )}
      </div>
      <div className="max-w-[460px] text-center">
        <h1 className="text-xl font-semibold text-ink">
          This page doesn&apos;t exist <span className="text-ink-3">·</span> 这个页面不存在
        </h1>
        <p className="mt-3 text-sm leading-[1.8] text-muted">
          The address may be mistyped, or the token may never have been launched. <span className="text-ink-3">·</span> 地址可能输错了，或者这个币从未发射。
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/explore" className="grad-fill inline-flex min-h-12 items-center rounded-full px-7 text-[15px] font-[550]">
          Explore tokens · 浏览代币
        </Link>
        <Link href="/verify" className="inline-flex min-h-12 items-center rounded-full border border-stroke-2 px-7 text-[15px] font-[550] text-ink-2 hover:border-brand hover:text-brand">
          Verify contracts · 核验合约
        </Link>
      </div>
    </div>
  );
}
