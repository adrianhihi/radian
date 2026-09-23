import { redirect } from "next/navigation";

// Short referral links: /r/0xABC… → /?ref=0xABC…. ReferralCapture (mounted in
// the root layout) stores the tag for 30 days; every router trade and launch
// then carries it and the PoundVault credits the referrer.
export default async function ReferralRedirect({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  redirect(/^0x[0-9a-fA-F]{40}$/.test(ref) ? `/?ref=${ref}` : "/");
}
