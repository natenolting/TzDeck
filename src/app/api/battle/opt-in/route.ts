import { syncHoldingsThen } from "@/lib/battle/holdingsSync";
import type { SignedRequestBody } from "@/lib/battle/requestAuth";
import { signedAttemptRoute } from "@/lib/battle/signedRoute";
import { commitParticipation } from "@/lib/battle/store";

// Bounded so a large collection resumes across requests rather than a
// single invocation trying to page through everything at once -- see
// holdingsSync.ts for the elapsed-time budget that backs this up (a page
// count alone doesn't bound wall-clock time against this limit).
export const maxDuration = 20;

interface OptInBody extends SignedRequestBody {
  optedIn: boolean;
}

export const POST = signedAttemptRoute<OptInBody>({
  action: "opt-in",
  // Independent of the daily attack/defense caps, and generous enough that a
  // large wallet's bounded continuation loop can legitimately resubmit many
  // times in a burst without tripping this, while still bounding abuse.
  rateLimit: { key: "optin", windowSeconds: 60, maxRequests: 20 },
  parse: (body) => {
    const { optedIn } = body as Partial<Record<"optedIn", unknown>>;
    return typeof optedIn === "boolean" ? { ...body, optedIn } : null;
  },
  params: (body) => [body.optedIn],
  run: (attempt, { optedIn }) => {
    const commit = (syncId: string | null) =>
      commitParticipation(attempt.nonce, attempt.generation, attempt.wallet, attempt.paramHash, optedIn, syncId);
    return optedIn ? syncHoldingsThen(attempt, commit) : commit(null);
  },
});
