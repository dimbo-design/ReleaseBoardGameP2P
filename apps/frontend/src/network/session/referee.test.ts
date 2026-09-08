import { createFakeEngine, FAKE_DECK, FAKE_EVENTS, TURN_ACTION_MS } from '@release/engine/fake'
import {
  ABSENT_GRACE_MS,
  applyIntent,
  createSession,
  disconnect,
  driveAbsent,
  rebind,
  type Session,
  type SessionResult,
  tick,
} from './referee'

// Not exported from @release/engine or @release/engine/fake, so this is a
// duplicated literal rather than an import — kept as a named constant (instead
// of an inline 15_000) so a future bump to the real constant in
// packages/engine/src/fake/window.ts shows up here as an intentional edit
// rather than this test silently drifting out of sync.
const WINDOW_FIRST_MS = 15_000

function twoPlayerSession() {
  return createSession({
    gameId: 'g1',
    keeperId: 'a',
    engine: createFakeEngine(),
    // Seed 42 puts a trigger card (publicly revealed on draw, per Task 4's
    // "hides the drawn card" test) at the top of pile 0. Seed 1 deals a normal
    // card there instead, so a draw stays private to the drawer as intended.
    seed: 1,
    players: [
      { playerId: 'a', peerId: 'peer-a', name: 'Ann' },
      { playerId: 'b', peerId: 'peer-b', name: 'Bo' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })
}

// The referee used to reduce, fan out and forget. That is exactly why a peer
// which missed a batch could never afterwards be told what was in it.
it('accumulates every event it has reduced', () => {
  const { session: start } = twoPlayerSession()
  const { session } = applyIntent(start, 'peer-a', { type: 'DRAW' }, 1_000)
  expect(session.log.length).toBeGreaterThan(start.log.length)
})

it('keeps the log in id order', () => {
  const { session: start } = twoPlayerSession()
  const { session } = applyIntent(start, 'peer-a', { type: 'DRAW' }, 1_000)
  const ids = session.log.map((e) => e.id)
  expect(ids).toEqual([...ids].sort((a, b) => a - b))
})

// The deal itself is in the log from the start: it is the first thing the
// engine emitted, and a peer restoring the match needs it to draw its own hand.
it('has the opening deal in it before anyone has acted', () => {
  const { session } = twoPlayerSession()
  expect(session.log.length).toBeGreaterThan(0)
})

// One step of driving whichever seat holds the turn, using only applyIntent:
// pays a pending release cost, plays a release when one is playable, else
// draws or pushes. `twoPlayerSession()`'s seed-1 opening hand holds no release
// and its `setup: {}` means releaseCond isn't 'easy', so a release play first
// suspends on a `discardForRelease` pending rather than opening a window in
// one step — both this and openWindowFixture below need to pay that cost, so
// it lives in one place rather than two copies drifting apart.
function stepTurn(session: Session, at: number): SessionResult {
  const turnPlayer = session.state.turn.player
  const peerId = turnPlayer === 'a' ? 'peer-a' : 'peer-b'
  const pending = session.state.pending
  const view = session.engine.project(session.state, turnPlayer)

  if (pending?.kind === 'discardForRelease' && pending.player === turnPlayer) {
    const spare = view.self.hand.find((c) => c.uid !== pending.release)
    if (!spare) return { session, outgoing: [] }
    return applyIntent(
      session,
      peerId,
      { type: 'RESOLVE', choice: { kind: 'discardForRelease', card: spare.uid } },
      at,
    )
  }

  // `uid.startsWith('release-')` is a *test fixture* convenience over the
  // fake's uid format, not production code — nothing under `src/network/` may
  // infer a `CardId` from a `CardUid`.
  const release = view.self.playable.find((uid) => uid.startsWith('release-'))
  if (release) return applyIntent(session, peerId, { type: 'PLAY', card: release }, at)
  if (session.state.turn.drawnFrom.length === 0)
    return applyIntent(session, peerId, { type: 'DRAW' }, at)
  return applyIntent(session, peerId, { type: 'PUSH' }, at)
}

// Plays until a release is standing with its price unpaid. Same driver as
// openWindowFixture below, but it stops the step BEFORE `stepTurn` pays the
// cost rather than after — that pending is the state under test.
function costPendingFixture(start: Session): Session {
  let session = start
  for (let step = 0; step < 200; step += 1) {
    if (session.state.pending?.kind === 'discardForRelease') return session
    const next = stepTurn(session, 1_000)
    if (next.session === session) break
    session = next.session
  }
  throw new Error('fixture failed to stage an unpaid release')
}

// Plays through both seats' turns until a release opens a reaction window.
// Uses the view's `playable` list, so it stays correct if the fake's deck
// changes.
function openWindowFixture(start: Session): Session {
  let session = start
  for (let step = 0; step < 200 && !session.state.window; step += 1) {
    const next = stepTurn(session, 1_000)
    if (next.session === session) break
    session = next.session
  }
  if (!session.state.window) throw new Error('fixture failed to open a window')
  return session
}

it('opens the feed with the deal rather than a blank', () => {
  const { outgoing } = createSession({
    gameId: 'g1',
    keeperId: 'p1',
    engine: createFakeEngine(),
    seed: 7,
    players: [
      { playerId: 'p1', peerId: 'peer-1', name: 'One' },
      { playerId: 'p2', peerId: 'peer-2', name: 'Two' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })

  const syncs = outgoing.filter((o) => o.message.type === 'SYNC')
  expect(syncs).toHaveLength(2)
  for (const s of syncs) {
    if (s.message.type !== 'SYNC') continue
    const dealt = s.message.payload.events.filter((e) => e.type === 'dealt')
    // The deal is public, so every seat hears about every seat's hand size.
    expect(dealt).toHaveLength(2)
  }
})

it('reserves the deal`s event ids and starts play right after them', () => {
  const { session, outgoing } = createSession({
    gameId: 'g1',
    keeperId: 'p1',
    engine: createFakeEngine(),
    seed: 7,
    players: [
      { playerId: 'p1', peerId: 'peer-1', name: 'One' },
      { playerId: 'p2', peerId: 'peer-2', name: 'Two' },
    ],
    setup: {},
    deck: FAKE_DECK,
    events: FAKE_EVENTS,
  })

  const opening = outgoing.find((o) => o.message.type === 'SYNC')
  const dealtIds =
    opening?.message.type === 'SYNC'
      ? opening.message.payload.events.filter((e) => e.type === 'dealt').map((e) => e.id)
      : []
  // Literal, not re-derived from seating length: this is the exact range the
  // engine reserved (Task 5's `eventSeq: seating.length`), and the property
  // under test is that nothing else lands in it and nothing after it repeats.
  expect(dealtIds).toEqual([1, 2])

  const { outgoing: played } = applyIntent(session, 'peer-1', { type: 'DRAW' }, 1_000)
  const drawSync = played.find((o) => o.message.type === 'SYNC' && o.to === 'peer-1')
  const drawnIds =
    drawSync?.message.type === 'SYNC' ? drawSync.message.payload.events.map((e) => e.id) : []
  // The reduce feed picks up immediately after the reserved deal range, with no
  // gap and no overlap. Asserted on the FIRST id rather than the whole list: how
  // many events one draw emits is the engine's business and has already changed
  // once (a sequenced draw emits several), while the boundary is the property
  // this test exists to hold.
  expect(drawnIds[0]).toBe(3)
  // Still contiguous among themselves, so nothing re-uses a reserved id.
  expect(drawnIds).toEqual(drawnIds.map((_, i) => 3 + i))
})

it('announces the game and syncs every seat privately', () => {
  const { outgoing } = twoPlayerSession()

  expect(outgoing[0]).toEqual({
    to: 'broadcast',
    message: { type: 'GAME_STARTED', payload: { gameId: 'g1', keeperId: 'a' } },
  })
  expect(outgoing.slice(1).map((o) => o.to)).toEqual(['peer-a', 'peer-b'])
  expect(outgoing.slice(1).every((o) => o.message.type === 'SYNC')).toBe(true)
})

it('sends each seat its own hand and never another seat`s', () => {
  const { outgoing } = twoPlayerSession()
  const [, toA, toB] = outgoing
  const viewA = toA.message.type === 'SYNC' ? toA.message.payload.view : null
  const viewB = toB.message.type === 'SYNC' ? toB.message.payload.view : null

  expect(viewA?.self.id).toBe('a')
  expect(viewB?.self.id).toBe('b')
  expect(viewA?.self.hand.length).toBeGreaterThan(0)
  // The opponent is a count, never an identity.
  expect(viewA?.opponents[0]).toMatchObject({ id: 'b' })
  expect(JSON.stringify(viewA)).not.toContain(viewB?.self.hand[0].uid)
})

it('never puts the seed or GameState on the wire', () => {
  const { outgoing } = twoPlayerSession()
  expect(JSON.stringify(outgoing)).not.toContain('"seed"')
  expect(JSON.stringify(outgoing)).not.toContain('rngCursor')
})

it('attributes an intent to the seat bound to the connection, not the payload', () => {
  const { session } = twoPlayerSession()
  // 'b' submits over peer-b while claiming to be 'a'. The claim is ignored, so
  // the action is 'b' drawing out of turn — and 'a' holds the turn.
  const { session: next, outgoing } = applyIntent(
    session,
    'peer-b',
    { type: 'DRAW', player: 'a' } as never,
    1_000,
  )

  expect(next).toBe(session)
  expect(outgoing.map((o) => o.to)).toEqual(['peer-b'])
})

it('refuses a keeper-only action arriving as a peer intent', () => {
  const { session } = twoPlayerSession()
  const opened = openWindowFixture(session)
  const window = opened.state.window
  if (!window) throw new Error('fixture failed to open a window')

  // `Intent` excludes WINDOW_EXPIRED in TypeScript only; the wire carries
  // parsed JSON, so the keeper has to refuse it at runtime. Submitted past the
  // deadline it would otherwise close the window out from under any pending
  // defence — the deadlock `tick` is written to avoid.
  const result = applyIntent(
    opened,
    'peer-b',
    { type: 'WINDOW_EXPIRED' } as never,
    window.deadline + 1,
  )

  expect(result.session).toBe(opened)
  expect(result.session.state.window).not.toBeNull()
  expect(result.outgoing).toEqual([])
})

it('refuses a payload that is not an intent at all', () => {
  const { session } = twoPlayerSession()

  // `parseEnvelope` checks type/from/seq and nothing else, so the payload is
  // whatever the connection carried. The guard that exists because of that
  // must not itself read through it: `null.type` is a TypeError, and over the
  // real transport it lands in the receive loop's catch — the keeper swallows
  // it in silence while the honest peers see nothing at all.
  for (const payload of [null, undefined, 'DRAW', 42, [], {}]) {
    const result = applyIntent(session, 'peer-a', payload, 1_000)
    expect(result.session).toBe(session)
    expect(result.outgoing).toEqual([])
  }
})

it('returns a rejection to the submitter alone', () => {
  const { session } = twoPlayerSession()
  const { outgoing } = applyIntent(session, 'peer-b', { type: 'PASS' }, 1_000)
  const only = outgoing[0]
  const events = only.message.type === 'SYNC' ? only.message.payload.events : []

  expect(outgoing).toHaveLength(1)
  expect(only.to).toBe('peer-b')
  expect(events.map((e) => e.type)).toEqual(['rejected'])
})

it('fans a committed action out to every connected seat', () => {
  const { session } = twoPlayerSession()
  const { session: next, outgoing } = applyIntent(session, 'peer-a', { type: 'DRAW' }, 1_000)

  expect(next).not.toBe(session)
  expect(outgoing.map((o) => o.to)).toEqual(['peer-a', 'peer-b'])
})

it('hides the drawn card from everyone but the drawer', () => {
  const { session } = twoPlayerSession()
  const { outgoing } = applyIntent(session, 'peer-a', { type: 'DRAW' }, 1_000)
  const [toA, toB] = outgoing
  const eventsA = toA.message.type === 'SYNC' ? toA.message.payload.events : []
  const eventsB = toB.message.type === 'SYNC' ? toB.message.payload.events : []
  const drawnA = eventsA.find((e) => e.type === 'drawn')
  const drawnB = eventsB.find((e) => e.type === 'drawn')

  expect(drawnA).toBeDefined()
  expect(drawnA?.type === 'drawn' ? drawnA.card : undefined).toBeDefined()
  // B learns a draw happened and the new deck size, never which card.
  expect(drawnB).toBeDefined()
  expect(drawnB?.type === 'drawn' ? drawnB.card : undefined).toBeUndefined()
})

it('stamps the keeper`s clock, ignoring any time the peer supplies', () => {
  const { session } = twoPlayerSession()
  // Drive right up to the discardForRelease decision (the same play-through as
  // openWindowFixture), then submit that final RESOLVE ourselves so we can
  // forge a wildly wrong `at` on it. That RESOLVE is what actually calls
  // placeRelease -> openWindow (packages/engine/src/fake/release.ts,
  // packages/engine/src/fake/window.ts): a window's deadline is
  // `at + WINDOW_FIRST_MS`, so if it were ever taken from the peer's forged
  // value instead of the keeper's `now`, it would land near
  // 999_999_999 + WINDOW_FIRST_MS instead of near the `now` passed below.
  let s = session
  for (let step = 0; step < 200; step += 1) {
    if (s.state.pending?.kind === 'discardForRelease') break
    const next = stepTurn(s, 1_000)
    if (next.session === s) throw new Error('fixture stalled before a release cost was pending')
    s = next.session
  }
  const pending = s.state.pending
  if (pending?.kind !== 'discardForRelease') {
    throw new Error('fixture failed to reach a release cost decision')
  }

  const peerId = pending.player === 'a' ? 'peer-a' : 'peer-b'
  const view = s.engine.project(s.state, pending.player)
  const spare = view.self.hand.find((c) => c.uid !== pending.release)
  if (!spare) throw new Error('no spare card to pay the release cost')

  const { session: next } = applyIntent(
    s,
    peerId,
    {
      type: 'RESOLVE',
      choice: { kind: 'discardForRelease', card: spare.uid },
      at: 999_999_999,
    } as never,
    5_000,
  )

  expect(next.state.window?.deadline).toBe(5_000 + WINDOW_FIRST_MS)
})

it('ignores an intent from a peer bound to no seat', () => {
  const { session } = twoPlayerSession()
  const result = applyIntent(session, 'peer-stranger', { type: 'DRAW' }, 1_000)

  expect(result.session).toBe(session)
  expect(result.outgoing).toEqual([])
})

it('starts the first turn`s inactivity clock on its first tick', () => {
  const { session } = twoPlayerSession()
  // createGame carries no timestamp, so the first turn has no clock until the
  // keeper's ticker goes live — which only happens once the start gate opens.
  expect(session.state.turn.deadline).toBeUndefined()

  const result = tick(session, 1_000)

  expect(result.session.state.turn.openedAt).toBe(1_000)
  expect(result.session.state.turn.deadline).toBe(1_000 + TURN_ACTION_MS)
  // The stamp travels like any other commit: one private SYNC per seat.
  expect(result.outgoing.map((o) => o.to)).toEqual(['peer-a', 'peer-b'])
})

it('does nothing while no deadline has passed', () => {
  const { session } = twoPlayerSession()
  const started = tick(session, 1_000).session
  const result = tick(started, 2_000)

  expect(result.session).toBe(started)
  expect(result.outgoing).toEqual([])
})

it('auto-resolves a minimal turn once the inactivity clock expires', () => {
  const { session } = twoPlayerSession()
  const started = tick(session, 1_000).session
  const deadline = started.state.turn.deadline ?? 0
  const handBefore = started.state.players.a.hand.length

  const result = tick(started, deadline + 1)

  // The idle player's whole obligation resolves in one expiry — the mandatory
  // draw, then the push — rather than one action per fresh 30s window.
  expect(result.session.state.players.a.hand.length).toBe(handBefore + 1)
  expect(result.session.state.turn.player).toBe('b')
  // Both halves land in ONE sync per seat — the feed reads as one beat.
  const sync = result.outgoing.find((o) => o.to === 'peer-b')
  const types = sync?.message.type === 'SYNC' ? sync.message.payload.events.map((e) => e.type) : []
  expect(types).toContain('drawn')
  expect(types).toContain('turnEnded')
  expect(types).toContain('turnStarted')
  expect(result.session.state.turn.openedAt).toBe(deadline + 1)
})

it('only pushes on expiry when the draw obligation is already met', () => {
  const { session } = twoPlayerSession()
  const drawn = applyIntent(session, 'peer-a', { type: 'DRAW' }, 1_000).session
  const deadline = drawn.state.turn.deadline ?? 0
  const handBefore = drawn.state.players.a.hand.length

  const result = tick(drawn, deadline + 1)

  expect(result.session.state.players.a.hand.length).toBe(handBefore)
  expect(result.session.state.turn.player).toBe('b')
})

// #101 (review round 2). Paying a release's price is the turn's own owner
// acting inside their own turn, so the engine keeps stamping the deadline
// through it — which means the keeper has to keep firing it. Deferring here
// (as every other pending does) would leave the deadline set and nothing
// watching it: a player could stop their own clock by staging a release.
it('keeps firing the turn deadline while a release waits for its price', () => {
  const { session } = twoPlayerSession()
  const staged = costPendingFixture(tick(session, 1_000).session)
  const owner = staged.state.turn.player
  const deadline = staged.state.turn.deadline ?? 0
  expect(deadline).toBeGreaterThan(0)

  // nothing yet — the clock is running, not expired
  expect(tick(staged, deadline - 1).session).toBe(staged)

  const result = tick(staged, deadline + 1)

  // the unpaid release goes back first: while an unpaid release stands,
  // anything other than paying takes it back — and nothing paid it. It is also
  // what makes the draw/push reachable, since the engine refuses both while
  // any pending is open.
  expect(result.session.state.pending).toBeNull()
  expect(result.session.state.turn.player).not.toBe(owner)
})

// The release is TAKEN BACK, not paid for. Paying is the other thing an expiry
// could plausibly do — it is exactly what `botAction` does with this pending
// (packages/engine/src/fake/bots.ts), and what `driveAbsent` uses for a seat
// that has actually left. A timeout is not a decision to spend a card, so the
// zone stays empty and the release stays in the hand it never left.
it('takes the unpaid release back rather than paying for it', () => {
  const { session } = twoPlayerSession()
  const staged = costPendingFixture(tick(session, 1_000).session)
  const pending = staged.state.pending
  if (pending?.kind !== 'discardForRelease') throw new Error('fixture lost its pending')
  const owner = pending.player
  const release = pending.release
  const zoneBefore = Object.keys(staged.state.players[owner].release).length

  const result = tick(staged, (staged.state.turn.deadline ?? 0) + 1)

  const after = result.session.state.players[owner]
  // the release did not land — had the expiry paid, this slot would be filled
  expect(Object.keys(after.release).length).toBe(zoneBefore)
  expect(after.hand.some((c) => c.uid === release)).toBe(true)
  expect(result.session.state.decks.discard.some((c) => c.uid === release)).toBe(false)
})

it('leaves an expired turn to driveAbsent when its seat is disconnected', () => {
  const { session } = twoPlayerSession()
  const started = tick(session, 1_000).session
  const gone: Session = {
    ...started,
    seats: started.seats.map((s) => (s.playerId === 'a' ? { ...s, peerId: null } : s)),
  }
  const deadline = gone.state.turn.deadline ?? 0

  const result = tick(gone, deadline + 1)

  // The same rule as a stalled defence: a deadline never fires against a seat
  // with nobody in it — the absence grace period owns that seat's forward
  // progress instead.
  expect(result.session).toBe(gone)
  expect(result.outgoing).toEqual([])
})

it('expires a reaction window once its deadline passes', () => {
  const { session } = twoPlayerSession()
  const opened = openWindowFixture(session)
  expect(opened.state.window).not.toBeNull()

  const result = tick(opened, (opened.state.window?.deadline ?? 0) + 1)

  expect(result.session.state.window).toBeNull()
  expect(result.outgoing.length).toBeGreaterThan(0)
})

it('expires a window a deadline-free pending would otherwise hold open', () => {
  const { session } = twoPlayerSession()
  const opened = openWindowFixture(session)
  const window = opened.state.window
  if (!window) throw new Error('fixture failed to open a window')

  // `handLimit` carries no deadline of its own (packages/engine/src/state.ts),
  // so nothing else would ever close this window. Injected rather than played
  // into existence: the two coexisting is a shape the fake's card set does not
  // currently reach, and the guard has to be right the day it does.
  const blocked: Session = {
    ...opened,
    state: { ...opened.state, pending: { kind: 'handLimit', player: 'b', excess: 1 } },
  }

  const result = tick(blocked, window.deadline + 1)

  expect(result.session.state.window).toBeNull()
  expect(result.session.state.pending?.kind).toBe('handLimit')
})

it('lets a stalled defence resolve even after its window has expired', () => {
  const { session } = twoPlayerSession()
  const opened = openWindowFixture(session)
  const window = opened.state.window
  if (!window) throw new Error('fixture failed to open a window')

  // Throw a release attack into the open window: onAttack (attacks.ts) sets a
  // `defend` pending with its own deadline but leaves `state.window` open, so
  // the two coexist. DEFEND_MS === WINDOW_FIRST_MS (both 15_000, core.ts /
  // window.ts), so an attack thrown the instant the window opens gives the
  // window and the defend pending the same deadline.
  const owner = window.target.player
  const responder = owner === 'a' ? 'b' : 'a'
  const responderPeer = responder === 'a' ? 'peer-a' : 'peer-b'
  const view = opened.engine.project(opened.state, responder)
  const attackCard = view.window?.canAttackWith[0]
  if (!attackCard) throw new Error('fixture responder has no release attack to throw')

  const attacked = applyIntent(opened, responderPeer, { type: 'ATTACK', card: attackCard }, 1_000)
  expect(attacked.session.state.pending?.kind).toBe('defend')
  expect(attacked.session.state.window).not.toBeNull()

  // Tick past both deadlines at once, as the keeper's normal cadence would.
  const deadline = attacked.session.state.window?.deadline ?? 0
  const result = tick(attacked.session, deadline + 1)

  // The stalled defence must still resolve to its passive default, not stay
  // stuck forever because the window closed out from under it. Taking the hit
  // closes the window itself (onDefend's release-scope path), so both clear.
  expect(result.session.state.pending).toBeNull()
  expect(result.session.state.window).toBeNull()
})

it('never closes a live reaction window on an absent seat`s behalf', () => {
  const { session } = twoPlayerSession()
  const opened = openWindowFixture(session)
  const window = opened.state.window
  if (!window) throw new Error('fixture failed to open a window')

  // The window's own owner is the seat botAction answers with WINDOW_EXPIRED
  // (packages/engine/src/fake/bots.ts) — stamped at the deadline rather than
  // now. Replaying that forged `at` would end the other seats' reaction time
  // the instant the grace period elapses, up to a whole window early.
  const owner = window.target.player
  const absent: Session = {
    ...opened,
    seats: opened.seats.map((s) =>
      s.playerId === owner ? { ...s, peerId: null, absentSince: 0 } : s,
    ),
  }

  const result = driveAbsent(absent, ABSENT_GRACE_MS + 1)

  expect(result.session.state.window).not.toBeNull()
  expect(result.session.state.window?.deadline).toBe(window.deadline)
})

it('leaves a stalled defence for a disconnected seat to resolve on reconnection', () => {
  const { session } = twoPlayerSession()
  const opened = openWindowFixture(session)
  const window = opened.state.window
  if (!window) throw new Error('fixture failed to open a window')

  const owner = window.target.player
  const responder = owner === 'a' ? 'b' : 'a'
  const responderPeer = responder === 'a' ? 'peer-a' : 'peer-b'
  const view = opened.engine.project(opened.state, responder)
  const attackCard = view.window?.canAttackWith[0]
  if (!attackCard) throw new Error('fixture responder has no release attack to throw')

  const attacked = applyIntent(opened, responderPeer, { type: 'ATTACK', card: attackCard }, 1_000)
  expect(attacked.session.state.pending?.kind).toBe('defend')

  // The owing seat drops before the deadline passes.
  const disconnected = {
    ...attacked.session,
    seats: attacked.session.seats.map((s) => (s.playerId === owner ? { ...s, peerId: null } : s)),
  }
  const deadline = disconnected.state.window?.deadline ?? 0
  const result = tick(disconnected, deadline + 1)

  // Nobody is there to resolve on the owing player's behalf, so the pending
  // waits rather than being force-resolved: it is not the keeper's decision
  // to make for an absent player.
  expect(result.session).toBe(disconnected)
  expect(result.outgoing).toEqual([])
})

// The reviewer's scenario on #113, decided as: the absence shield hands the
// turn BACK on return, it does not spend it. The deadline expires while the
// seat is empty (tick refuses to fire it — driveAbsent's grace owns absence),
// and the player comes back inside the grace window. Without the re-stamp the
// very next tick would see a seated player and an expired clock, and auto-play
// their whole turn before they get a single frame to act in.
it('hands a returning player a fresh clock instead of playing them out', () => {
  const { session } = twoPlayerSession()
  const started = tick(session, 1_000).session
  const deadline = started.state.turn.deadline ?? 0
  const player = started.state.turn.player
  const seat = started.seats.find((s) => s.playerId === player)
  const handBefore = started.state.players[player].hand.length

  // They drop before the deadline; the expiry then fires into an empty seat
  // and is deferred, exactly as tick's own comment promises.
  const dropped = disconnect(started, seat?.peerId ?? '', deadline - 5_000).session
  const deferred = tick(dropped, deadline + 1)
  expect(deferred.session).toBe(dropped)

  // Back inside the absence grace. The rebind restores the seat AND the turn:
  // a fresh clock, stamped at the return.
  const returned = rebind(dropped, player, 'peer-back', deadline + 10_000)
  expect(returned.session.state.turn.deadline).toBe(deadline + 10_000 + TURN_ACTION_MS)
  // The re-stamp is a state change every seat renders (the dock's ring), so it
  // travels to everyone, not only the rejoiner.
  expect(returned.outgoing.map((o) => o.to).sort()).toEqual(
    returned.session.seats
      .map((s) => s.peerId)
      .filter((p): p is string => p !== null)
      .sort(),
  )

  // The moment that used to lose the turn: the next tick. Nothing fires.
  const after = tick(returned.session, deadline + 10_001)
  expect(after.session).toBe(returned.session)
  expect(returned.session.state.turn.player).toBe(player)
  expect(returned.session.state.players[player].hand.length).toBe(handBefore)
})

it('leaves a live clock alone when its owner reconnects — no extension', () => {
  const { session } = twoPlayerSession()
  const started = tick(session, 1_000).session
  const deadline = started.state.turn.deadline ?? 0
  const player = started.state.turn.player
  const seat = started.seats.find((s) => s.playerId === player)

  const dropped = disconnect(started, seat?.peerId ?? '', 2_000).session
  // Back BEFORE the deadline: the remaining time stands — blinking the
  // connection buys nothing.
  const returned = rebind(dropped, player, 'peer-back', deadline - 1_000)
  expect(returned.session.state.turn.deadline).toBe(deadline)
  expect(returned.outgoing).toHaveLength(1)
  expect(returned.outgoing[0].to).toBe('peer-back')
})

it('does not drive absent seats when no seat is connected at all', () => {
  const { session } = twoPlayerSession()
  const empty: Session = {
    ...session,
    seats: session.seats.map((s) => ({ ...s, peerId: null, absentSince: 0 })),
  }
  const result = driveAbsent(empty, ABSENT_GRACE_MS + 1)
  // A keeper with no audience advances nothing: no state change, no fan-out.
  expect(result.session).toBe(empty)
  expect(result.outgoing).toEqual([])
})

it('still drives an absent seat while another seat is connected', () => {
  const { session } = twoPlayerSession()
  const oneGone: Session = {
    ...session,
    seats: session.seats.map((s) =>
      s.playerId === session.state.turn.player ? { ...s, peerId: null, absentSince: 0 } : s,
    ),
  }
  const result = driveAbsent(oneGone, ABSENT_GRACE_MS + 1)
  expect(result.session).not.toBe(oneGone)
})
