import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:4000";

const config: NextConfig = {
  // Browsers only ever talk to this origin. /api/* is forwarded to the API service, which keeps
  // the session cookie first-party and means the API needs no CORS.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "avatars.githubusercontent.com" }],
  },
  poweredByHeader: false,
  // The Docker image (apps/web/Dockerfile) needs a self-contained server that includes the
  // workspace packages. Vercel and `next start` don't, and `next start` warns if it's set.
  ...(process.env.NEXT_OUTPUT === "standalone" && {
    output: "standalone",
    outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  }),
};

export default config;
