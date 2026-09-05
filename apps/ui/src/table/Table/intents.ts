// Structural mirror of @release/engine's action surface. The kit carries no
// domain dependency (Decision 7), so these are declared rather than imported.
// apps/frontend/src/entities/game/contract.test-d.ts asserts both directions of
// assignability — if the engine adds a member and this file does not, the
// frontend stops compiling.

export type ReleaseSlotId = 'frontend' | 'backend' | 'database'
export type NeutralizeMethodId = 'debugger' | 'monitoring' | 'sacrifice'

export type TableTarget =
  | { kind: 'player'; player: string }
  | { kind: 'release'; player: string; slot: ReleaseSlotId }
  | { kind: 'monitoring'; player: string }
  | { kind: 'card'; card: string }
  // Mirrors the engine's pile target: Git Branch splits one of the draw piles,
  // and with several on the table the player picks which.
  | { kind: 'pile'; pile: number }

export type TableChoice =
  | { kind: 'discardForRelease'; card: string }
  // No slot: a Works on my Machine reflection returns the effect at the
  // attacker's release of the very type that was attacked, so the defender has
  // nothing to pick (mirrors the engine's Choice).
  | { kind: 'defend'; card: string | null; combo?: string }
  | { kind: 'neutralize503'; method: NeutralizeMethodId; card?: string }
  | { kind: 'crush'; method: NeutralizeMethodId; card?: string }
  | { kind: 'requestCard'; card: string }
  | { kind: 'giveCard'; card: string }
  | { kind: 'handLimit'; cards: string[] }
  | { kind: 'pickFromDiscard'; card: string; toDeck?: string }
  // The order committed per pile, index 0 becoming the new top — mirrors the
  // engine's own Choice.
  | { kind: 'reorderTop'; order: { pile: number; cards: string[] }[] }
  // System Upgrade: `upgradeDiscard` from a seat on the roster, `upgradeTake`
  // from the actor once every seat has answered — mirrors the engine's Choice.
  | { kind: 'upgradeDiscard'; card: string }
  | { kind: 'upgradeTake'; card: string }
  // Taking a staged release back before its cost is paid — see the engine's
  // own Choice for why it carries nothing.
  | { kind: 'cancelRelease' }

export type TablePending =
  | {
      kind: 'discardForRelease'
      player: string
      // The owner's own staged card, redacted for everyone else exactly as
      // `options` is — mirrors the engine's PendingView (Decision 7).
      release?: string
      options: string[]
    }
  | {
      kind: 'defend'
      player: string
      attacker: string
      attackCard: string
      sudo: boolean
      options: string[]
      openedAt: number
      deadline: number
      scope: 'release' | 'hand'
    }
  // null for the ai-error-503 mimic, which has no card standing anywhere to
  // show — mirrors the engine's PendingView (Decision 7).
  // Mirrors PendingView. NOTE: an *optional* field added on one side only is
  // NOT caught by engineContract.test-d.ts — `Exact` passes when the sole
  // difference is optional. What catches it is the board reading `.source`
  // against this type and failing to compile.
  | {
      kind: 'neutralize503'
      player: string
      card: string | null
      methods: NeutralizeMethodId[]
      source?: string
    }
  | {
      kind: 'crush'
      player: string
      slot: ReleaseSlotId
      methods: NeutralizeMethodId[]
      source?: string
    }
  | { kind: 'requestCard'; player: string; target: string }
  | { kind: 'giveCard'; player: string; requested: string }
  | { kind: 'handLimit'; player: string; excess: number; options: string[]; source?: string }
  | {
      kind: 'pickFromDiscard'
      player: string
      options: { uid: string; id: string }[]
      picks: 1 | 2
      source: string
    }
  | {
      kind: 'reorderTop'
      player: string
      piles: { pile: number; cards: { uid: string; id: string }[] }[]
      source: string
    }
  // System Upgrade — the one pending owed to SEVERAL seats at once, and so the
  // one with no `player`. Mirrors the engine's PendingView field for field
  // (Decision 7), including the omission: every other member has a `player`,
  // which is exactly what let a union-wide `pending.player` read compile, and
  // dropping it here makes the kit's own readers say what they meant instead.
  // Nothing is gated — the rules put the thrown cards face up at the centre.
  | {
      kind: 'systemUpgrade'
      actor: string
      owed: string[]
      thrown: { player: string; card: { uid: string; id: string } }[]
      sudo: boolean
      phase: 'discarding' | 'picking'
      source: string
    }

// The kit's own `pendingOwes` (the engine exports one under that name from
// state.ts). Declared rather than imported for the same reason TablePending is
// — the kit carries no domain dependency (Decision 7) — and kept to one
// expression so the two cannot drift into different answers about whose move
// it is. `systemUpgrade` owes its roster while it is discarding and the actor
// once it is picking; every other kind owes the single seat it names.
export function pendingOwesSelf(pending: TablePending | null | undefined, selfId: string): boolean {
  if (!pending) return false
  if (pending.kind !== 'systemUpgrade') return pending.player === selfId
  return pending.phase === 'picking' ? pending.actor === selfId : pending.owed.includes(selfId)
}

// The seat the table is waiting on, for a dock that has to name somebody. The
// mirror of `pendingOwesSelf` from the other side: the first seat still owing
// while a `systemUpgrade` is discarding, the actor once it is picking.
export function pendingOwedBy(pending: TablePending): string | undefined {
  if (pending.kind !== 'systemUpgrade') return pending.player
  return pending.phase === 'picking' ? pending.actor : pending.owed[0]
}

export interface TableWindow {
  player: string
  slot: ReleaseSlotId
  round: number
  // Both ends of the span, so the ring's sweep is exact rather than assumed.
  openedAt: number
  deadline: number
  passed: string[]
  canAttackWith: string[]
}

// Intents out. Never an Action — the kit does not know the player's id or the
// clock; the consumer stamps both (Decision 8).
export interface TableActions {
  onPlay?: (card: string, target?: TableTarget, combo?: string) => void
  onDraw?: (pile?: number) => void
  onPush?: () => void
  onAttack?: (card: string, combo?: string) => void
  onPass?: () => void
  onUnpass?: () => void
  onResolve?: (choice: TableChoice) => void
  onWindowExpired?: () => void
  onOverContinue?: () => void
  // Legality is the engine's answer, never the UI's. Returns [] when the card
  // needs no target.
  legalTargets?: (card: string) => TableTarget[]
}
