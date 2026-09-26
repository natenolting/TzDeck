import { syncHoldingsThen } from "@/lib/battle/holdingsSync";
import { signedAttemptRoute } from "@/lib/battle/signedRoute";
import { commitHoldingsRefresh } from "@/lib/battle/store";

// Bounded so a large collection resumes across requests rather than a
// single invocation trying to page through everything at once -- see
// holdingsSync.ts for the elapsed-time budget that backs this up (a page
// count alone doesn't bound wall-clock time against this limit).
export const maxDuration = 20;

/**
 * Authenticated holdings refresh -- signs `[]` since it has no desired-state
 * parameter and cannot alter opt-in, distinct from the opt-in action even
 * though it shares the same underlying materialization pipeline. No
 * automatic unauthenticated write is hidden behind GET status.
 */
export const POST = signedAttemptRoute({
  action: "refresh",
  // Same reasoning as opt-in's budget: generous enough for a large wallet's
  // bounded continuation loop, still a real bound on outright abuse.
  rateLimit: { key: "refresh", windowSeconds: 60, maxRequests: 20 },
  parse: (body) => body,
  params: () => [],
  run: (attempt) =>
    syncHoldingsThen(attempt, (syncId) =>
      commitHoldingsRefresh(attempt.nonce, attempt.generation, attempt.wallet, attempt.paramHash, syncId),
    ),
});
