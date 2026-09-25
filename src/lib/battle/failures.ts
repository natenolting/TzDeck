/**
 * Every way a claimed battle attempt can be turned down by a route, with the
 * HTTP status it answers with and whether the attempt ledger lets the same
 * signed request try again. The code is the only thing a call site names.
 */
export const BATTLE_FAILURES = {
  attacker_card_not_held: { status: 409, retryable: false },
  attacker_card_self_minted: { status: 409, retryable: false },
  attacker_recovering: { status: 409, retryable: false },
  attacker_metadata_unavailable: { status: 503, retryable: true },
  ownership_unverifiable: { status: 503, retryable: true },
  defender_card_not_held: { status: 409, retryable: false },
  self_challenge: { status: 400, retryable: false },
  target_not_eligible: { status: 409, retryable: false },
  trainer_tier_locked: { status: 409, retryable: false },
} as const satisfies Record<string, { status: number; retryable: boolean }>;

export type BattleFailureCode = keyof typeof BATTLE_FAILURES;

export class AttemptRejection extends Error {
  constructor(readonly code: BattleFailureCode) {
    super(code);
    this.name = "AttemptRejection";
  }
}

export function reject(code: BattleFailureCode): never {
  throw new AttemptRejection(code);
}
