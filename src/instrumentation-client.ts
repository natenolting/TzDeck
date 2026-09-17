import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN
    ?? "https://89d2c1393083b5ae287876cb6b68f57b@o4512103360692224.ingest.us.sentry.io/4512103382974464",
  // Browser bundles only see NEXT_PUBLIC_* vars; Vercel exposes this one automatically.
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
