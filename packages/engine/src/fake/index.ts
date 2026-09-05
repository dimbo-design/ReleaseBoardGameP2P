import type { DeckEntry, Engine } from '../engine'
import { project } from './project'
import { legalTargets, reduce } from './reduce'
import { createGame, setupEvents } from './setup'

export { botAction, runUntilIdle } from './bots'
// The keeper's absent-seat fallback needs the same answer the engine gives
// itself about whether a turn still owes a draw — one predicate, so the
// keeper and the reducer cannot disagree about when a turn may end.
export { drawObligationMet, TURN_ACTION_MS } from './core'

// Quantities mirror apps/ui/src/cards/catalogue.ts. Every id the fake
// implements appears — nothing is deferred any more — and createGame filters
// anything unsupported anyway.
export const FAKE_DECK: DeckEntry[] = [
  { id: 'release-frontend', qty: 4 },
  { id: 'release-backend', qty: 4 },
  { id: 'release-database', qty: 5 },
  { id: 'attack-security-bug', qty: 5 },
  { id: 'attack-ddos', qty: 6 },
  { id: 'attack-bug', qty: 7 },
  { id: 'attack-legacy-code', qty: 3 },
  { id: 'attack-out-of-memory', qty: 2 },
  { id: 'defense-not-a-bug', qty: 2 },
  { id: 'defense-works-on-my-machine', qty: 2 },
  { id: 'defense-rollback', qty: 3 },
  { id: 'defense-hotfix', qty: 3 },
  { id: 'defense-pr-approved', qty: 2 },
  { id: 'defense-rubber-ducky', qty: 2 },
  { id: 'protection-monitoring', qty: 4 },
  { id: 'protection-debugger', qty: 8 },
  // Quantities from rules decisions answer 12.
  { id: 'operation-git-branch', qty: 3 },
  { id: 'operation-git-merge', qty: 2 },
  { id: 'support-sudo', qty: 5 },
  { id: 'support-code-review', qty: 5 },
  { id: 'trigger-error-503', qty: 7 },
  { id: 'trigger-ai', qty: 12 },
  { id: 'operation-git-cherry-pick', qty: 3 },
  { id: 'operation-git-rebase', qty: 3 },
  { id: 'operation-system-upgrade', qty: 2 },
]

export const FAKE_EVENTS: DeckEntry[] = [
  { id: 'ai-crush-database', qty: 2 },
  { id: 'ai-crush-frontend', qty: 2 },
  { id: 'ai-crush-backend', qty: 2 },
  { id: 'ai-monitoring', qty: 2 },
  { id: 'ai-release-database', qty: 1 },
  { id: 'ai-release-frontend', qty: 1 },
  { id: 'ai-release-backend', qty: 1 },
  { id: 'ai-good-vibe-coding', qty: 3 },
  { id: 'ai-bad-vibe-coding', qty: 2 },
  { id: 'ai-hallucination', qty: 2 },
  { id: 'ai-error-503', qty: 1 },
  { id: 'ai-inside', qty: 2 },
]

export function createFakeEngine(): Engine {
  return { createGame, setupEvents, reduce, project, legalTargets }
}
