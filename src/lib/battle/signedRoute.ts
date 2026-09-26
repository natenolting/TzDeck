import { NextRequest, NextResponse } from "next/server";

import { AttemptRejection, BATTLE_FAILURES } from "./failures";
import { authenticateAndClaim, isSignedRequestBodyShapeValid, type SignedRequestBody } from "./requestAuth";
import { checkRateLimit, failAttempt, type CommitResult } from "./store";

export interface ClaimedAttempt {
  wallet: string;
  nonce: string;
  generation: string;
  /** The hash of the signed parameters, which the participation and refresh commits check. */
  paramHash: string;
  /** When the request arrived, so a time budget covers the auth and database work too. */
  receivedAt: number;
}

export interface SignedAttemptRoute<B extends SignedRequestBody> {
  action: string;
  rateLimit: { key: string; windowSeconds: number; maxRequests: number };
  /** The action's own fields on an already shape-checked signed body, or null if they are missing or malformed. */
  parse: (body: SignedRequestBody) => B | null;
  /** The positional parameters the wallet signed for this action. */
  params: (body: B) => ReadonlyArray<string | number | boolean>;
  /** The claimed attempt's work. Throw through `reject()` to turn the attempt down. */
  run: (attempt: ClaimedAttempt, body: B) => Promise<CommitResult>;
}

function errorJson(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/**
 * The POST handler shared by every wallet-signed battle action: body checks,
 * the signature and attempt claim, and recording a rejection in the attempt
 * ledger with the status and retryability its failure code carries.
 */
export function signedAttemptRoute<B extends SignedRequestBody>(route: SignedAttemptRoute<B>) {
  return async function POST(request: NextRequest): Promise<NextResponse> {
    const receivedAt = Date.now();
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return errorJson(400, "invalid_json_body");
    }
    const body = isSignedRequestBodyShapeValid(raw) ? route.parse(raw) : null;
    if (!body) return errorJson(400, "missing_required_fields");

    try {
      const { key, windowSeconds, maxRequests } = route.rateLimit;
      const auth = await authenticateAndClaim(body, route.action, route.params(body), {
        checkBudget: (wallet) => checkRateLimit(`${key}:${wallet}`, windowSeconds, maxRequests),
      });
      switch (auth.outcome) {
        case "rejected":
          return errorJson(auth.status, auth.reason);
        case "in_progress":
          return NextResponse.json({ error: "attempt_in_progress" }, { status: 409, headers: { "Retry-After": "2" } });
        case "terminal":
          return NextResponse.json(auth.row.response, { status: auth.row.status_code ?? 200 });
        case "claimed":
          break;
      }

      const attempt: ClaimedAttempt = {
        wallet: auth.wallet,
        nonce: auth.nonce,
        generation: auth.generation,
        paramHash: auth.paramHash,
        receivedAt,
      };
      try {
        const { response, statusCode } = await route.run(attempt, body);
        return NextResponse.json(response, { status: statusCode });
      } catch (error) {
        if (!(error instanceof AttemptRejection)) throw error;
        const { status, retryable } = BATTLE_FAILURES[error.code];
        const response = { error: error.code, retryable };
        await failAttempt(attempt.nonce, attempt.generation, response, status, retryable);
        return NextResponse.json(response, { status });
      }
    } catch (error) {
      console.error(`Error in ${route.action} battle route:`, error);
      return errorJson(500, "internal_error");
    }
  };
}
