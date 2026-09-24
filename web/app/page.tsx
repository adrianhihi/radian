// "/" is the landing: one cinematic screen with its own slim header, so it does
// not use the app Shell. The launch list lives at /explore.
import { Landing } from "@/components/landing/Landing";

export default function HomePage() {
  return <Landing />;
}
