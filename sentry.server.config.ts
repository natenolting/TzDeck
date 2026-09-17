import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN
    ?? "https://89d2c1393083b5ae287876cb6b68f57b@o4512103360692224.ingest.us.sentry.io/4512103382974464",
  // Vercel builds preview deploys with NODE_ENV=production, so VERCEL_ENV is what
  // keeps preview errors out of the production environment in Sentry.
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  includeLocalVariables: true,
});
