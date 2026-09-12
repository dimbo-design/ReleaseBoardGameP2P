import type { CardId, ReleaseSlot } from './state'

// Rules metadata only. Art, display names and visual tags stay in
// apps/ui/src/cards/catalogue.ts; the two tables describe different facts about
// the same id and are joined by that id.
export type CardKind =
  | 'release'
  | 'attack'
  | 'cancel'
  | 'unicorn'
  | 'protection'
  | 'support'
  | 'trigger'
  | 'ai'
  | 'operation'

export interface CardRules {
  kind: CardKind
  // Has a sudo-enhanced variant, playable only with support-sudo alongside.
  sudo?: boolean
  // Release cards only: which zone slot they occupy.
  slot?: ReleaseSlot
}

// Every id the fake implements. Nothing is deferred any more: System Upgrade
// was the last one out, and it arrived with the first pending owed to several
// players at once (state.ts's `systemUpgrade`).
export const CARD_RULES: Record<CardId, CardRules> = {
  'release-frontend': { kind: 'release', slot: 'frontend' },
  'release-backend': { kind: 'release', slot: 'backend' },
  'release-database': { kind: 'release', slot: 'database' },

  'attack-bug': { kind: 'attack', sudo: true },
  'attack-out-of-memory': { kind: 'attack', sudo: true },
  'attack-legacy-code': { kind: 'attack', sudo: true },
  'attack-security-bug': { kind: 'attack', sudo: true },
  'attack-ddos': { kind: 'attack' },

  'defense-hotfix': { kind: 'cancel' },
  'defense-rubber-ducky': { kind: 'cancel' },
  'defense-pr-approved': { kind: 'cancel' },
  'defense-rollback': { kind: 'cancel', sudo: true },
  'defense-not-a-bug': { kind: 'unicorn' },
  'defense-works-on-my-machine': { kind: 'unicorn' },

  'protection-monitoring': { kind: 'protection' },
  'protection-debugger': { kind: 'protection' },

  'support-sudo': { kind: 'support' },
  'support-code-review': { kind: 'support' },

  'operation-git-cherry-pick': { kind: 'operation', sudo: true },
  'operation-git-branch': { kind: 'operation', sudo: true },
  'operation-git-merge': { kind: 'operation', sudo: true },
  'operation-git-rebase': { kind: 'operation', sudo: true },
  'operation-system-upgrade': { kind: 'operation', sudo: true },

  'trigger-error-503': { kind: 'trigger' },
  'trigger-ai': { kind: 'trigger' },

  'ai-crush-frontend': { kind: 'ai' },
  'ai-crush-backend': { kind: 'ai' },
  'ai-crush-database': { kind: 'ai' },
  'ai-monitoring': { kind: 'ai' },
  'ai-release-frontend': { kind: 'ai' },
  'ai-release-backend': { kind: 'ai' },
  'ai-release-database': { kind: 'ai' },
  'ai-good-vibe-coding': { kind: 'ai' },
  'ai-bad-vibe-coding': { kind: 'ai' },
  'ai-hallucination': { kind: 'ai' },
  'ai-error-503': { kind: 'ai' },
  'ai-inside': { kind: 'ai' },
}

export const SUPPORTED: ReadonlySet<CardId> = new Set(Object.keys(CARD_RULES))

// Undefined for an id the engine does not implement — callers treat that as
// "not playable" rather than an error, so an unsupported card in a deck is inert
// instead of fatal.
export const rulesFor = (id: CardId): CardRules | undefined => CARD_RULES[id]

// The four attacks that a fresh release is vulnerable to. DDoS is excluded: it is
// the only card that reaches a Code Review-protected release or a Monitoring, and
// it does not destroy a bare release, so it resolves on its own path.
export const RELEASE_ATTACKS: ReadonlySet<CardId> = new Set([
  'attack-bug',
  'attack-out-of-memory',
  'attack-legacy-code',
  'attack-security-bug',
])
