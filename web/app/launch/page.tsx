import { redirect } from "next/navigation";

// The wizard moved to /create; old links and bookmarks still land there.
export default function LaunchRedirect() {
  redirect("/create");
}
