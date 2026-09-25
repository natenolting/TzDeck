/** The body of GET /api/battle/status, shared by the route that builds it and the client that reads it. */
export interface BattleCardStatus {
  cardKey: string;
  xp: number;
  level: number;
  power: number;
  hp: number;
  recoveryUntil: string | null;
  recoveryReason: "offensive" | "defensive" | null;
}

export interface BattleStatus {
  optedIn: boolean;
  effectiveAttackCount: number;
  attackResetAt: string | null;
  effectiveDefenseCount: number;
  defenseResetAt: string | null;
  holdingsRefreshedAt: string | null;
  cards: BattleCardStatus[];
}
