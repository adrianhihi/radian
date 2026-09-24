// Wallet and RPC failures, in the person's words. The classification is by shape (viem error names
// and the messages every wallet and node agree on); the upstream text is kept in the copy for the
// cases where it carries information (a revert reason, an unknown failure), never hidden behind a
// friendlier sentence that would leave the person guessing.
import type { TKey, TVars } from "@/lib/i18n";

export type TxFail = "rejected" | "gas" | "reverted" | "timeout" | "network" | "unknown";

const text = (e: unknown): string => {
  const x = e as { shortMessage?: string; message?: string; details?: string; name?: string } | null;
  return [x?.shortMessage, x?.details, x?.message].filter((s): s is string => typeof s === "string" && s.length > 0).join(" · ");
};

export function classifyTxError(e: unknown): { kind: TxFail; detail: string } {
  const name = (e as { name?: string } | null)?.name ?? "";
  const m = text(e);
  const first = ((e as { shortMessage?: string; message?: string } | null)?.shortMessage ?? (e as { message?: string } | null)?.message ?? "").split("\n")[0].slice(0, 200);
  if (name === "UserRejectedRequestError" || /user rejected|user denied|rejected the request|denied transaction|cancel/i.test(m)) return { kind: "rejected", detail: first };
  if (/insufficient funds|exceeds the balance|gas required exceeds|not enough .* for gas/i.test(m)) return { kind: "gas", detail: first };
  if (name === "ContractFunctionExecutionError" || name === "TransactionExecutionError" || /revert|execution reverted/i.test(m)) return { kind: "reverted", detail: first };
  if (name === "TimeoutError" || /timed? ?out/i.test(m)) return { kind: "timeout", detail: first };
  if (name === "HttpRequestError" || /failed to fetch|network|econnre|rate limit|429|503/i.test(m)) return { kind: "network", detail: first };
  return { kind: "unknown", detail: first };
}

/**
 * The sentence to show for a failed signature or transaction. `gasSym` and `address` let the gas
 * case say what to send where; `fallback` is the page's generic "failed" copy for the unknown case
 * when the error carries no text at all.
 */
export function txErrorText(t: (key: TKey, vars?: TVars) => string, e: unknown, ctx: { gasSym?: string; address?: string; fallback?: string } = {}): string {
  const { kind, detail } = classifyTxError(e);
  switch (kind) {
    case "rejected":
      return t("tx.errRejected");
    case "gas":
      return t("tx.errGas", { sym: ctx.gasSym ?? "gas", addr: ctx.address ?? "" });
    case "reverted":
      return detail ? t("tx.errRevertedWhy", { m: detail }) : t("tx.errReverted");
    case "timeout":
      return t("tx.errTimeout");
    case "network":
      return t("tx.errNetwork");
    default:
      return detail ? t("tx.errUnknown", { m: detail }) : (ctx.fallback ?? t("tx.errNetwork"));
  }
}
