import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  org: "nate-nolting",
  project: "javascript-nextjs",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
  // The plugin documents throwing by default, but Next's runAfterProductionCompile
  // swallows that throw, so a 401 on SENTRY_AUTH_TOKEN shipped a green build with no
  // source maps. Rethrowing here does escape the hook. A build with no token attempts
  // no upload and stays green, so local and fork builds are unaffected.
  errorHandler: (err) => {
    throw err;
  },
});
