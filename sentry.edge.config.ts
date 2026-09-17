import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN
    ?? "https://89d2c1393083b5ae287876cb6b68f57b@o4512103360692224.ingest.us.sentry.io/4512103382974464",
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
});
