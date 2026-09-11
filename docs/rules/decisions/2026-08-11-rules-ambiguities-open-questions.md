# Rules ambiguities — open questions

**All eleven are answered.** The last three came back from the rules owner on 22.08.2026 and are
recorded in the spec — see below.

This file asked eleven questions. [`docs/rules/`](../rules/) — the written spec [#91](https://github.com/MythHand/ReleaseBoardGameP2P/pull/91) landed — answered eight of them, and those are recorded below with where the answer lives rather than deleted, so nobody re-asks them. Two of the eight have since been **superseded** by a refinement from the rules owner — see below.

The remaining three were answered on 22.08.2026 and their answers now live in the spec; one
divergence is noted for the record.

**The live pool is the [comment on #92](https://github.com/MythHand/ReleaseBoardGameP2P/pull/92#issuecomment-5277857784)**, asked fresh rather than as this list with parts crossed out. This file stays as the record of what was asked and what came back.

Each open question carries a recommendation. **"Agree with the recommendation" is a full answer**, and so is **"keep current behaviour"** — the point is that the engine stops deciding by accident.

## Answered by the rules owner (22.08.2026)

The three that were open. Each answer is now in the spec; the wording here is the owner's.

- [x] **1. Can DDoS be answered by a defence card?** — **No.** DDoS cannot be answered at all: it
  resolves the moment it is played and neither a Cancel nor a Unicorn stops it. The attack → defence
  chain of §2 does not apply to it, wholly rather than partly.
  → [`resolution.md` §5](../rules/resolution.md). Engine: already correct.

- [x] **2. Is a failed Security Bug request public?** — **Yes, hit and miss alike.** Like any attack
  card, Security Bug is played to the CENTRE of the table — that is the demonstration that it was
  played, and while the attacker is choosing it simply lies there for everyone. Once the choice is
  made the table sees openly which card was asked for, and sees the card handed over in the open. On
  a miss the others must likewise see which card was asked for and not received. This mirrors the
  physical table, where the action cannot be hidden.
  → [`cards.md`, Security Bug](../rules/cards.md). Engine: already broadcasts the miss.
  **Not built yet:** the playground has no beat for the miss — the requested card shown and not
  handed over. Recorded in [`docs/animations/backlog.md`](../animations/backlog.md); the owner is
  deliberately not building that animation now.

- [x] **3. Does an AI Release use up the one-release-per-turn allowance?** — **No.** The allowance
  counts only releases played FROM THE HAND. The event deck is about luck, not about a player's
  choice: counting it would distort the randomness itself (release cards would have to be excluded
  from the draw) and would catch an unintentional "double release" — you ship your own, then draw a
  card and an AI Release comes after it. Nothing blocks that, even if the randomness deals them in a
  row.
  → [`modes.md`, the release axis](../rules/modes.md). Engine: already free.

## Answered by the spec

Kept so the questions are not asked again. Nothing here needs a reply.

| # | Question | Where it is answered | Engine |
|---|---|---|---|
| 4 | DDoS against a freshly played Code Review release | [`resolution.md` §1, §5](../rules/resolution.md) — a protected release gives no attack time at all, and DDoS is not bound to freshness | correct |
| 5 | Which release Security Bug needs before the stolen one is discarded | [`cards.md`](../rules/cards.md) — a Release **of the same type** | correct |
| 6 | Is Monitoring's protection automatic or a choice | [`resolution.md` §7](../rules/resolution.md) — "порядок способов не задан, выбор за игроком" | correct; the recommendation here was **wrong** |
| 7 | Where an eliminated player's cards go | [`resolution.md` §7](../rules/resolution.md) — hand and zone to the discard, events-deck cards home | correct as of [#93](https://github.com/MythHand/ReleaseBoardGameP2P/issues/93) |
| 8 | Does a reflected attack get through Code Review | [`resolution.md` §4](../rules/resolution.md) — a protected release is taken only by DDoS, "даже с sudo" | fixed in [#74](https://github.com/MythHand/ReleaseBoardGameP2P/issues/74) |
| 9 | A reflected Security Bug — taken or destroyed | **superseded** — see below | it always discards |
| 10 | Which of the attacker's releases a reflected attack hits | **superseded** — see below | the attacked type, not a choice |

## Superseded — the spec text has not caught up yet

Rows 9 and 10 above were answered from `resolution.md`, and the rules owner has since
[refined the ruling](https://github.com/MythHand/ReleaseBoardGameP2P/pull/92#issuecomment-5265618826):
the wording those rows quote was the harder of two readings, and the **mirror** reading is the one
the card supports without an added rule.

- **A reflected Security Bug can never take a release — it always discards.** The reflected "take
  into your zone" aims at the defender's slot of the attacked type, and that slot is always occupied
  by the very release being defended, which never left because the attack was cancelled.
- **There is no slot to choose.** The effect returns at the attacker's release of *exactly the type
  that was attacked*. It lands only if they hold that type and it is not under Code Review;
  otherwise the attack is still cancelled and the second effect finds nothing — which is not the
  same as not firing.

Row 8 stands: Code Review still holds against a reflected attack.

Implemented in [#94](https://github.com/MythHand/ReleaseBoardGameP2P/pull/94). The spec text in
`cards.md` §184 and `resolution.md` §90/§139/§140/§142 still carries the old reading; the rules owner
is rewriting those on a branch off #91, so the divergence is tracked in
[`docs/rules/backlog.md`](../rules/backlog.md) rather than patched from here.

## Noted, not asked

**Who starts.** The rules keep a social rule — "первым ходит тот, кто последним релизил на прод" ([`general.md` §3](../rules/general.md)) — and the engine seats the host first. A divergence by necessity rather than a question; recorded so it is written down somewhere.
