"use client";

// Renders the few dictionary entries that carry inline emphasis (<em>, <b>,
// <code>) as elements without innerHTML: a tiny parser that knows exactly
// three tags; anything else stays literal text.
import { Fragment } from "react";

const token = () => /<(em|b|code)>([\s\S]*?)<\/\1>/g;

const WRAP = {
  em: (k: number, s: string) => (
    <em key={k} className="bg-[image:var(--brand-grad)] bg-clip-text not-italic text-transparent">
      {s}
    </em>
  ),
  b: (k: number, s: string) => (
    <b key={k} className="font-medium text-ink">
      {s}
    </b>
  ),
  code: (k: number, s: string) => (
    <code key={k} className="mono-label rounded border border-stroke-2 bg-glass-2 px-[5px] py-px text-[.92em]">
      {s}
    </code>
  ),
} as const;

export function RichText({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  const re = token();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<Fragment key={k++}>{text.slice(last, m.index)}</Fragment>);
    out.push(WRAP[m[1] as keyof typeof WRAP](k++, m[2]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={k++}>{text.slice(last)}</Fragment>);
  return <>{out}</>;
}
