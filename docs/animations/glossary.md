# Glossary — animation properties & tuning values

The **properties and values** you work with when driving animations: the parameters you pass into
`play(...)`, the easing tokens, and the tuning constants (geometry, timing, holds). The callable
modules that consume these (presets, helpers, hooks) are catalogued in
[`reference.md`](./reference.md); the game-situation sequences are in [`recipes.md`](./recipes.md).

Values are transcribed from code (paths per section). If a number here disagrees with the code,
the code wins — fix this file.

---

## 1. Easing tokens — `apps/ui/src/animations/presets.ts`

| Name | Value | Used by |
|---|---|---|
| `EASE` | `cubic-bezier(0.4, 0, 0.2, 1)` | every preset except the four below |
| `LAND` | `cubic-bezier(0.34, 0.8, 0.2, 1)` | a CARD landing on its place: `playToReleaseZone`, and `foldIntoPair` / `landInPose` when called with `snap` |
| `SNAP` | `cubic-bezier(0.2, 0.9, 0.1, 1)` | a small element APPEARING in its slot: `popIn` / `popOut` (the dock's «добор» badge, the toasts) |
| per-keyframe | `ease-out` → `ease-in` | `confettiFly` only — the throw accelerates out, the arc falls back in, so the easing lives on the keyframes and not on the animation |

**`LAND` and `SNAP` are the same idea at two scales, and that is why there are two.** `SNAP` puts
almost the whole distance in the first fifth of the time — over 200–260ms that reads as "it is
there", which is right for something that has no path to show. A card DOES have a path across the
table, and on 480–620ms the same curve read as a throw rather than as a flight with a landing (the
release into its zone, the sudo tucking under a defence). `LAND` keeps the soft arrival and lets the
travel be seen.

`EASE` is the same curve as the `--ease-soft` CSS token. There is no CSS token for `LAND` or `SNAP`:
they exist only in the registry, so a CSS transition cannot reproduce either landing.

---

## 2. Parameters passed to `play(...)`

The words that flow into a preset as `params`.

| Param | Type | Meaning |
|---|---|---|
| `from` / `to` | `Rect` = `{ left, top, width, height }` | source / target geometry for a travel preset |
| `rotate` | number (deg) | final rotation of the flyer at landing |
| `dx` / `dy` | number (px) | travel presets: extra final offset (land in the exact pose, no post-jump). `hudIn` and `confettiFly` read them differently — see below |
| `fade` | boolean | dissolve opacity during the flight (baked into `absorbToDeck` / `dealToSeat`) |
| `duration` | number (ms) | override the default time — **travel presets only** |
| `dur` | number (ms) | override the default time — **the slot / HUD / fold / shake presets** (`rollOut`, `rollIn`, `popIn`-family, `hudIn`, `foldIntoPair`, `confettiFly`, `shake`) |
| `delay` | number (ms) | hold the element at its first keyframe before starting (`rollIn`, `hudIn`; both are `fill: 'both'`, which is what makes the wait invisible instead of a flash) |
| `faceDown` | boolean | `flipCard` direction (the `Card` auto-plays `flipCard` when this prop changes) |
| `box` | `Rect` | `foldIntoPair`: the frame of the pair — where the halves fold INTO |
| `pose` | string (transform) | `foldIntoPair`: the resting pose of this half inside the pair. Empty for the main one (it IS the frame); `PAIR_AUX_POSE` for the aux |
| `snap` | boolean | `foldIntoPair` / `landInPose`: land on the `LAND` curve instead of `EASE` (the half that tucks under; a card settling on the table) |
| `amp` | number (px) | `shake`: the swing of the first jolt. 7 by default — sized for an input field; a whole fan takes ~9 |
| `shape` | `'settle' \| 'spring'` | `shake`: the CHARACTER, a key of `SHAKE_SHAPES` (§3) |
| `peak` | number (px) | `confettiFly`: the height of the arc at its top (frame 0.42) |
| `spin` | number (deg) | `confettiFly`: how far the piece turns over its whole flight |

> **The duration word is a trap.** `duration` and `dur` mean the same thing and are not
> interchangeable: a travel preset reads `duration` via `durationOf`, the rest destructure `dur`.
> Pass the wrong one and nothing errors — the preset silently keeps its default. Check the preset's
> row in [`reference.md`](./reference.md) before overriding a time.
>
> **`dx`/`dy` are directional in two different senses.** For a travel preset they are a nudge added
> to the LANDING. For `hudIn` they are where the block comes FROM (`0/0` = a plain fade, no
> movement); for `confettiFly` they are where the piece ends up.
>
> Two rect shapes: travel presets use `{ left, top, width, height }`; `Point` (arrows) uses `{ x, y }`.
>
> `seq` (seen in recipes) is **not** a `play()` argument — it is the flyer's React `key`, bumped per
> flight so React mounts a fresh `Card` instead of reusing one (**I5**).

---

## 3. Geometry & layout values

| Name | Value | Where | What |
|---|---|---|---|
| `CARD_RATIO` | `1.4` (height / width) | `@/primitives/Card` | card art proportion. Reciprocal of the `--card-aspect` CSS token (`368 / 515`, width / height) — keep JS names off "aspect" to avoid the opposite convention. |
| `CARD_W` | `150` | `@/table/Hand/fan` | canonical hand-card width (the real source) |
| `SOURCE_CARD_W` | `140` | `CardToHandStory` | preview source-card width |
| `ROT` / `DX_FRAC` / `DY_FRAC` | `14` / `0.083` / `0.067` | `scatter.ts` | scatter ±ranges: tilt `±14°` (absolute — a tilt does not scale with size), offsets as FRACTIONS of the card width (`≈ ±10px` / `±8px` at `REF_WIDTH = 120`), so a heap looks equally tossed at any card size |
| `PAIR_AUX` / `PAIR_AUX_POSE` | `{ rot: -7, dy: -26 }` → `translateY(-26%) rotate(-7deg)` | `@/primitives/CardPair` | the aux card's pose inside a pair. Declared as **data**, the CSS string derived from it — three readers need two forms: the component and `foldIntoPair` take the string, `useDiscardExit` takes `.rot` as a number when a pair splits and the aux half flies out at the tilt it was seen at. Same shape as `Scatter` + `restTransform` for the heap. (`dy` is a % of the card height; a split does not need it — the half's place comes from its measured rect.) |
| `SHAKE_SHAPES` | `settle: 1, 6/7, 4/7, 3/7` · `spring: 1, 1, 2/3, 2/3` | `presets.ts` | the character of a shake as fractions of `amp`, out-and-back through zero. `settle` = a jolt that calms down (an input field), `spring` = two full swings then two smaller (a large element that flinched whole) |
| `--z-flight` | `250` | `tokens.css` | the BASE of the flight band — above the hand and a lifted card, below the arrow and the overlays. Every flyer reads it; `useHandArrival` holds it for `START_HIGH_MS` before dropping to the slot's own layer |
| flight band offsets | `+n` / `+10` / `+40` | `useDiscardExit`, `Error503Story`, `Pile` | on top of `--z-flight`: `n` = the card's own table layer, so a group keeps its order (**I9**); `+10` = a card held by the cursor, above anything flying on its own; `+40` = the pile counter, clear of the whole band so an arriving card passes under the badge |
| `--z-card-preview` | `320` | `tokens.css` | reading a card that stands on the table. Above the WHOLE flight band, counter included: a card can fly to the discard while it is being read, and the reading must stay on top of it. Below the arrow — a preview is looking, aiming is playing |
| `--z-drawer` | `350` | `tokens.css` | a side sheet (`Drawer`). Above the flight band and above the arrow — a panel is open, there is nothing to aim at — and below the reaction window, which is about the run of the game and has to reach through any service panel |
| `PREVIEW_H` / `PREVIEW_W` | `476` / `340` | `@/table/CardPreview` | the read-across-the-table size: the hand's own hover zoom (`ZOOM_MAX_H = 460`) plus 15%, then back down a tenth — big next to the discard without shouting. The width follows from `CARD_WH` |
| `GAP_MS` | `90` | `@/table/CardPreview` | how long LEAVING a readable slot waits before the preview closes. Slots stand a few px apart and crossing that gap is two frames; without the wait the preview blinks off and straight back on. Showing is immediate — there is nothing to wait for, the card is already on the table |
| `CARD_WH` | `368 / 515` (width / height) | `@/table/Hand` | inverse of `CARD_RATIO`; sizes the drag flyer height and the zoom preview |
| `HOVER_LIFT` / `NEIGHBOR_PUSH` | `28` / `36` | `@/table/Hand` | hover: lift of the hovered card / spread of its neighbours (px) |
| `BAND_PAD` | `32` | `@/table/Hand` | how far above the fan still counts as "in the hand" (reorder) vs a play |
| `DRAG_THRESHOLD` | `6` | `@/table/Hand` | pointer travel (px) that turns a press into a drag (below it = a click) |
| `ZOOM_TOP_AIR` / `ZOOM_GAP` | `32` / `44` | `@/table/Hand` | zoom preview: min gap from the top edge / gap above the fan |
| `ZOOM_MIN_H` / `ZOOM_MAX_H` | `240` / `460` | `@/table/Hand` | zoom preview height clamp |
| `SPREAD_DEG` / `ARC_DROP` | `3.8` / `2.5` | `@/table/Hand/fan` | fan tilt per step (deg) / arc drop across the fan (`handStep` also uses tuned quadratic `STEP_ANCHORS`) |
| `APPROACH_REACH` / `APPROACH_RISE_DEG` | `1` / `40` | `@/table/Hand/fan` | `insertPath`: how far out the control point stands, in **steps between cards** (the fan's own unit, so the sweep breathes with the hand) / how far up the arc it may ride. A quadratic travels half way to its control point, so a reach of one step bulges half a step — which is how much overlap the layer switch has taken off it |
| `PATH_STEPS` | `24` | `@/table/Hand/fan` | how many positions `insertPath` is handed over as; straight lines are drawn between them, so it is "often enough that no corner survives a frame" |
| `REVEAL_W` | `220` | pick / cherry / sysupg | width a card reaches at the centre before the hand-insert |
| `GRID_W` | `100` (pick) / `150` (cherry) | selection-grid card width |
| `CENTER_W` / `THROW_SCALE` | `150` / `0.42` | `SystemUpgrade` | thrown-card width at the centre / start scale at the seat |

Card widths differ per view by design — not duplicates.

---

## 4. Timing values

All in ms. Durations and holds are **tuned parameters, not duplicates** — some intentionally key off
another animation's timing (a deliberate cascade, e.g. `wait(FLIP_MS + 150)` waits out a flip before
the next step). Treat them as verified choreography; change them only with a live check in the
playground.

| Name | Value | Where | Beat |
|---|---|---|---|
| `START_HIGH_MS` | `140` | `useHandArrival` | how long the travel layer is held before the card tucks under the fan |
| `FLIGHT_MS` / `FLIGHT_EASE` | `480` / `cubic-bezier(0.4, 0, 0.2, 1)` | `useHandArrival` | arrival into the fan: the clock the `insertPath` positions are played on. The easing is the literal value of `--ease-soft` — WAAPI takes a value, not a custom property |
| `FLIGHT_MS` | `420` | `useDiscardExit` | discard flight — matches `centerToDiscard`, so the table tilt finishes unwinding exactly as the card lands |
| `FLIP_MS` | `420` | `DrawCardStory` | mirror of the `flipCard` preset — JS waits the in-place flip |
| `SPLIT_MS` | `520` | `DeckAnimationsStory` | the `flyFrom` split fly-out duration |
| `MERGE_MS` | `520` | `DeckAnimationsStory` | each deck's `absorbToDeck` flight on merge |
| `MERGE_MS` (pair) | `620` | `ComboStory`, `DefenseReleaseStory` | the fold into a pair — the `dur` both halves are given. Same name, a different movement: one merges decks, the other folds two cards |
| `SHOW_HOLD` / `LAND_HOLD` | `1200` / `700` | `DefenseReleaseStory` | a card stands open on the table before it moves on / the attack rests at the centre before it can be answered |
| `ATTACK_POSE` / `COVER_POSE` / `SUDO_POSE` | `rot -4` / `rot 6, dx 16, dy -12` / `rot -7` | `DefenseReleaseStory` | cards thrown on the table are not laid straight: the attack lands tilted, the defence covers it at another angle and offset (so the two read as two plays, not one neat stack), the defender's own Sudo waits at its own tilt |
| `GATHER_MS` | `360` | `DeckAnimationsStory` | gather the scattered discard before it flies |
| `TURN_MS` | `460` | `DeckAnimationsStory` | flip a card back-up in place (discard→deck / merge prep) |
| `AI_HOLD` | `4000` | `DrawCardStory` | table hold while the AI effect is read |
| `REVEAL_HOLD` | `820` | `PickOpponentCardStory` | pause after flip, before scatter |
| `SPLIT_HOLD` | `600` | `DeckAnimationsStory` | pause after split, before touching discard |
| `CENTER_HOLD` | `420` | `DeckAnimationsStory` | card rests at center before leaving to discard |
| `STEP_HOLD` | `360` | `DeckAnimationsStory` | standard short beat between deck steps |
| `SETTLE_MS` | `460` | `@/table/Hand` | reorder / rejected-play landing back in the fan — the whole sweep along `insertPath`, at `SETTLE_EASE` |
| `SETTLE_EASE` | `cubic-bezier(0.4, 0, 0.2, 1)` | `@/table/Hand` | the speed along that sweep. The literal value of `--ease-soft`: WAAPI takes a value, not a custom property |
| `SWITCH_AT` | `0.35` | `@/table/Hand` | the fraction of `SETTLE_MS` at which the landing card drops into its slot's layer. Under `SETTLE_EASE` the middle of the PATH plays at `0.35` of the CLOCK, and the middle of the path is the apex of the sweep — the card at its furthest from its right neighbour |
| `ResizeMs` | `200` | `Error503Story` | dragged defence eases from its source width to `CARD_W` |
| `ELIM_MIN_MS` | `5000` | `Error503Story` | minimum elimination-video play time before it fades |
| `COVER_DX` / `COVER_DY` | `16` / `-12` | `Error503Story` | the answer covers the 503 nudged, so both cards are read |
| `COVER_HOLD` | `1200` | `Error503Story` | the answer and the alarm stand open before they leave together |
| `GATHER_HOLD` | `1500` | `Error503Story` · `HandLimitStory` | cards gathered at the centre are held before they scatter — the sweep's heap and the hand limit's grid, one value |
| `CLEAR_STEP` | `90` | `HandLimitStory` | between cards as the finished grid leaves for the discard |
| `PICK_HOLD` | `900` | `AiCardsStory` | Bad Vibe: the given-up card stands beside the AI card before both leave |
| `TABLE_HOLD` | `2600` | `AiCardsStory` | hold on the table after an AI card reveals, before it resolves |
| `HALLUCINATION_HOLD` | `5200` | `AiCardsStory` | `×2 TABLE_HOLD` — Hallucination lingers |
| `SHOW_HOLD` | `1500` | `AiCardsStory` | a card shown to all at the centre (Inside / Bad Vibe) |
| `PICK_BEAT` | `620` | pick stories | chosen holds / others leave, before the check |
| `REVEAL_HOLD` (pick-specific) | `820` | `PickSpecificCardStory` | centre hold after the flip, before the drop |
| `CENTER_HOLD` (pick) | `820` | `OpponentTakesCardStory` | centre hold before the card flies up to the opponent |
| `MISS_HOLD` | `1620` | pick stories | shake / note before the fan leaves (miss case) |
| `REVEAL_HOLD` (git) | `560` | `CherryPick`, `SystemUpgrade` | centre hold before the sudo card drops into the hand |
| `DEAL_DUR` / `DEAL_STEP` | `360`/`16` (cherry), `520`/`80` (rebase) | Git cards | deal cards out / per-card stagger |
| `RETURN_DUR` / `RETURN_STEP` | `420`/`14` | `CherryPick` | return unpicked to the pile / stagger |
| `DECK_DUR` / `DECK_HOLD` | `480`/`360` | `CherryPick` | sudo deck-card flight (`returnToDeck`) / face-down hold |
| `BACK_DUR` / `BACK_STEP` | `600`/`90` | `Rebase` | fly the reordered three back to the deck / stagger |
| `THROW_DUR` / `THROW_STEP` | `460`/`260` | `SystemUpgrade` | seat → centre throw / per-opponent stagger |
| `HOLD_MS` / `CLEAR_STEP` | `2500`/`90` | `SystemUpgrade` | base hold before discard / centre → discard stagger |

### The two ends of a match

`GameDealStory` — the interface arriving, then the deal. Every beat of the arrival is one `hudIn`,
and `BEAT` is the pause between beats, so the order reads as an order and not as one event.

| Name | Value | Beat |
|---|---|---|
| `RAIL_MS` | `640` | the page rail slides in from its own edge (`dx: 44`) |
| `BG_MS` | `900` | the table layer with its grid — a plain fade, and the longest: it is the room lighting up |
| `PILE_MS` / `PILE_STAGGER` | `620` / `180` | the decks from the left (`dx: -34`) and the discard from the right (`dx: 34`) — one after the other, not together |
| `SEAT_MS` / `SEAT_STAGGER` | `560` / `140` | the opponent seats drop in from above (`dy: -28`), each after the one before |
| `DOCK_DELAY` | `320` | the dock rises from below (`dy: 30`) in the same beat as the seats |
| `ZONE_MS` | `620` | the player's own release zone (`dy: 22`) — last of all, and only after the hand has turned over |
| `BEAT` | `320` | the pause between one beat of the arrival and the next |
| `DEAL_LEAD` | `420` | the table is set; before the first card leaves the deck |
| `DEAL_STEP` / `ROUND_GAP` | `230` / `160` | between one card and the next / an extra breath between rounds, so rounds stay countable |
| `HEAP_HOLD` | `640` | the finished heap stands open at the centre before it goes to the fan |
| `FLIP_HOLD` / `REVEAL_HOLD` | `380` / `620` | it is all in the hand, then it turns over / the hand is read, and only then the zone arrives |

`GameEndStory` / `features/board-beats/gameEndBeat.tsx` — the release-condition victory, the
poppers, the window. The live runner keys from `gameOver(condition: 'release')`, so direct,
Security Bug and AI Release wins share the same celebration.

| Name | Value | Beat |
|---|---|---|
| `POPPERS` | `[0, 1] [620, 0.7] [1450, 1.25]` | `[when, power]` — three separate bangs, not one repeated. Power drives the piece count, the reach and the time in the air, which is what makes them three events |
| `POP_PER_SIDE` | `33` | pieces per corner, before power scales it |
| `OVER_AT` | `2400` | the GameOver window comes up WHILE the confetti is still in the air |
| `CONFETTI_MS` | `8500` | by then every piece has flown its arc out and the volley can be taken down |

---

## 5. Data / content constants

Not animation tuning, listed for completeness: `BASE`, `AI_DECK`, `NON_TRIGGER`, `ORDINARY_POOL`,
`DECK_COUNTS`, `SOURCES`, `RELEASE_SLOTS`, `DISCARD_N`, `CARD_H`, `INITIAL_HAND`, card ids
(`BRANCH`, `MERGE`, `SUDO`), trigger ids (`ERROR_503`, `AI_TRIGGER`).

> `DEAL_CARD_W`, `COLS_MAX`, `GAP_X` / `GAP_Y` and `ORIGIN` used to be listed here and above, as the
> geometry of a deal-grid in `PickOpponentCardStory`. That grid exists in no story: three of the four
> names exist nowhere in the repository, and `ORIGIN` survives only in `@/cards/useCardTilt` meaning
> something else entirely (a pointer's rest position). They were the glossary's half of the same drift
> that had `recipes.md` transcribing a scene it had never read (#105). Removed rather than repointed:
> there is nothing to point at.

---

> Changing any tuned value is a code change — verify it live in the playground and judge it by the
> on-screen result (the no-reinterpretation rule in [`README.md`](./README.md)).
