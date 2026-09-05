import { CARD_RULES, RELEASE_ATTACKS, rulesFor, SUPPORTED } from './cards'

it('exposes every table key as supported', () => {
  expect(SUPPORTED.size).toBe(Object.keys(CARD_RULES).length)
  for (const id of Object.keys(CARD_RULES)) expect(SUPPORTED.has(id)).toBe(true)
})

it('gives every release card a distinct slot', () => {
  const slots = Object.entries(CARD_RULES)
    .filter(([, r]) => r.kind === 'release')
    .map(([, r]) => r.slot)
  expect(slots.sort()).toEqual(['backend', 'database', 'frontend'])
})

it('assigns a slot only to release cards', () => {
  for (const [id, r] of Object.entries(CARD_RULES)) {
    if (r.kind === 'release') expect(r.slot, id).toBeDefined()
    else expect(r.slot, id).toBeUndefined()
  }
})

it('treats every release attack as a supported attack card', () => {
  for (const id of RELEASE_ATTACKS) {
    expect(rulesFor(id)?.kind, id).toBe('attack')
  }
  // DDoS attacks, but not on this path — it is the only card reaching a
  // protected release or a Monitoring.
  expect(rulesFor('attack-ddos')?.kind).toBe('attack')
  expect(RELEASE_ATTACKS.has('attack-ddos')).toBe(false)
})

it('implements System Upgrade as a sudo-capable operation', () => {
  expect(rulesFor('operation-system-upgrade')).toEqual({ kind: 'operation', sudo: true })
})

it('implements Git Cherry-pick as a sudo-capable operation', () => {
  expect(rulesFor('operation-git-cherry-pick')).toEqual({ kind: 'operation', sudo: true })
})

it('implements Git Rebase as a sudo-capable operation', () => {
  expect(rulesFor('operation-git-rebase')).toEqual({ kind: 'operation', sudo: true })
})

it('returns undefined for an unknown id rather than throwing', () => {
  expect(() => rulesFor('not-a-card')).not.toThrow()
  expect(rulesFor('not-a-card')).toBeUndefined()
})
