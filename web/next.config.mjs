import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this app. A stray lockfile higher up the tree
  // makes Next infer the home directory as the root, which turns the dev
  // file-watcher onto the whole home folder (EMFILE) and breaks routing.
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
};

export default nextConfig;
