# CLAUDE.md — Project Guide

## Overview

**Release любой ценой** — a P2P web version of the board card game.

**Rules and card mechanics — [`docs/rules/`](./docs/rules/).** The player-facing rules text is
canon and lives in the translation catalog (`rulesBlock.text`); `docs/rules/rules-board-game.md` is
that same text as md. Everything else in the folder is the **technical spec** of the same rules —
what happens, in what order, under which card id: `general` (frame of a match), `cards` (every card
with its id, print run, effect, what cancels it), `resolution` (order of resolution — windows,
priority, when a win is final), `modes` (the five mode axes), `backlog` (disputed and undecided).
Do not "improve" the rules text from the spec; a disagreement means the text wins and the finding
goes to `docs/rules/backlog.md`.

**Working on the rules, guessing is forbidden.** Not "by the sense of it", not "obviously", not
"at a table this is how it goes". Anything that so much as hints at inference becomes an open
question in `docs/rules/backlog.md` **and** a marker in the spec at the exact paragraph where it
came up (`> ❓ **Не из правил.**`). A guess written down as a rule stops being a guess: code gets
written from it, a test pins it, and it becomes the source everyone checks against.

**An AI card never leaves the game.** It is always in the events deck, in a release zone, or being
played at the centre of the table. Do not describe it as burnt or discarded: an AI release given up to
answer a 503 is *sacrificed*, and an AI card leaving the table goes *back to the events deck*. Wording
like this steers every agent that reads it.

**Design specs live in [`docs/specs/`](./docs/specs/)** (`YYYY-MM-DD-<topic>-design.md`).

What exists today: the monorepo skeleton, the UI component library, the frontend shell, and the P2P networking layer (`apps/frontend/src/network/` plus the self-hosted signaling server). Game logic — the in-game board screens — is out of scope for this phase and lives in later specs.

---

## Monorepo Layout

| Path | Package | Purpose |
|---|---|---|
| `apps/ui` | `@release/ui` | Shared component library — TypeScript + CSS Modules + design tokens; i18n-agnostic |
| `apps/playground` | `@release/playground` | Vite sandbox for developing and previewing UI components in isolation |
| `apps/frontend` | `@release/web` | Main web app — Vite + React + CSS Modules |
| `apps/peerserver` | `@release/peerserver` | Self-hosted PeerJS signaling server (Express + `ExpressPeerServer`), shipped as a Docker image to GHCR |
| `packages/translation` | `@release/translation` | i18next setup + locale catalogs (`en`/`ru`) + typed-key augmentation; consumed by `@release/web` |
| `packages/lint` | `@release/lint` | Shared Biome / Stylelint / TypeScript configs, and the `release-lint` / `release-tsc` wrappers |

Package manager: **pnpm** (workspace defined in `pnpm-workspace.yaml` as `apps/*` and `packages/*`).

`apps/frontend`, `apps/playground` and `apps/ui` each carry their own `CLAUDE.md` with rules
additive to this one — read the relevant one before editing inside that app.

---

## Stack Per App

### `@release/ui`
- TypeScript, React 19 (peer dep)
- CSS Modules for component styles
- Design tokens as CSS custom properties (`src/design/tokens.css`, `src/design/global.css`)
- Exports: `@release/ui` → `src/index.ts`, `@release/ui/animations` → `src/animations/index.ts`, `@release/ui/tokens.css`, `@release/ui/global.css`
- **The animation layer is a separate entry point.** `@release/ui` is things to render; `@release/ui/animations` is how a thing moves — the preset vocabulary, the timing/scatter helpers, and the flight steps (`useFlyer`, `useHandArrival`). It is deliberately NOT re-exported from the component barrel, so the boundary is real rather than a naming convention. Inside `apps/ui`, a component reaches for a leaf module (`@/animations/play`) rather than the barrel: the barrel carries the steps, and the steps render components.
- No i18n dependency — all copy is received via props

### `@release/playground`
- Vite + React 19
- Consumes `@release/ui` from source via Vite alias (see UI Consumption below)
- CSS Modules only — purely for component rendering

### `@release/web` (frontend)
- Vite + React 19 + TypeScript
- CSS Modules for component styles, design tokens via `@release/ui/tokens.css`
- i18n through `@release/translation` — never `react-i18next` directly (see the i18n Rule)
- Consumes `@release/ui` from source via Vite alias

### `@release/peerserver`
- TypeScript (NodeNext ESM), Express 4, `peer` (PeerServer)
- Env config: `PORT` / `PEER_PATH` / `PEER_KEY`; `/health` endpoint
- Docker image via `apps/peerserver/Dockerfile`; published to GHCR by `.github/workflows/peerserver.yml` on `peerserver-v*` tags
- Dev: `pnpm dev:p2p` runs it alongside the frontend

---

## Commands

```bash
# Install all workspace deps
pnpm install

# Run the frontend dev server (apps/frontend)
pnpm dev

# Run the playground dev server (apps/playground)
pnpm dev:playground

# Run frontend + playground together (so the frontend's /playground/ link
# proxies to the running playground app). Needed only when using that link.
pnpm dev:all

# Run the frontend against the local signaling server instead of the public
# PeerJS broker. Without it, `pnpm dev` uses the public broker.
pnpm dev:p2p

# Build all packages (pnpm -r build)
pnpm build

# Lint: Biome check (root) + Stylelint across all packages
pnpm lint

# Format with Biome (writes)
pnpm format

# Type-check all packages
pnpm typecheck

# Run all tests
pnpm test
```

The `lint` script runs `release-lint check --error-on-warnings .` (the shared Biome config from `@release/lint`) followed by `pnpm -r stylelint` (per-package Stylelint). Biome handles JS/TS formatting and linting. Stylelint handles CSS files.

---

## Styling Rule

Styling is uniform across all packages: **CSS Modules + design tokens.**

- Every styled component/page has a co-located `*.module.css`. Colors, fonts,
  gradients, timings come from the design tokens in
  [`apps/ui/src/design/tokens.css`](./apps/ui/src/design/tokens.css) via
  `var(--*)` — never hardcode a color (`#hex`, `rgb()`, named). Missing a
  color → add a token there first.
- All text is set through the `<Typography>` component from `@release/ui`
  (semantic `variant`, or raw `base` + `tk` for the long tail) — no
  hand-written font declarations and no `composes` from the scale in module
  CSS. Full rule: [apps/ui/CLAUDE.md](./apps/ui/CLAUDE.md#typography-rule).
- Spacing/sizing are plain px values; use logical properties
  (`padding-inline`, `margin-block-start`) — stylelint enforces this.
- **No Tailwind anywhere** — removed in
  [#47](https://github.com/MythHand/ReleaseBoardGameP2P/issues/47); stylelint
  rejects its at-rules.
- **`apps/ui/src/screens/` is the visual source of truth.** It ships `Start`,
  `Lobby`, `Invite` and `Stats` — open the matching playground story and match
  its values before restyling the frontend.
  - `Start`, `Lobby` and `Invite` are **read as reference and re-implemented**
    in `apps/frontend`; do not import them. Their module CSS uses `composes`
    from the typography scale, which the frontend must not copy — convert each
    to `<Typography base=… tk=…>` instead.
  - `Stats` is the exception: `pages/board/[gameId]/stats.tsx` renders it
    straight from `@release/ui`.

---

## Code Comments Rule

- **Write code comments in English.** Do not add Russian comments to source files (existing Russian comments are legacy).

---

## i18n Rule

- **`@release/translation` is the single i18n surface.** It owns the i18next init,
  `i18next-browser-languagedetector`, and the typed-key augmentation, and re-exports the
  react-i18next binding. `@release/web` gets `useTranslation()` from it and **never depends on
  `react-i18next` directly**.
- Translation catalogs live under `packages/translation/src/locales/en/common.json` and
  `…/ru/common.json`. A key must exist in **both** — a key missing from one silently falls back.
- **No string literals in `.tsx` files** — all user-visible text must go through `t()` or translation keys.
- **`@release/ui`** is i18n-agnostic — it does not import or use i18next. All display copy is passed in as props by the consuming app.

---

## Animations Rule

- Анимации собираются **из модулей**, а не пишутся полётами вручную. Словарь и хелперы — в `apps/ui/src/animations/`: пресеты через `play('name', el, params)` плюс `jitter`, `wait`, `nextFrames`. Нужен новый кусочек — оформляй его модулем, потом используй.
- **Источник состояния работы с анимациями — страница плейграунда `Interaction audit`** (`apps/playground/stories/AnimationAuditStory`): какие модули готовы (со статусами), какие сценарии из них собраны, и реестр находок. Перед работой над анимациями сверяй актуальные статусы там; при изменениях вписывай их обратно в эту страницу. Живой каталог самого словаря — соседняя страница `Animations`: каждый пресет показан в своей форме и запускается.
- **Письменная пара этих страниц — [`docs/animations/`](./docs/animations/)**, спека под чтение агентом: `README` (модель и инварианты I1–I10), `recipes` (последовательности по игровым ситуациям), `reference` (вызываемое: пресеты, хелперы, шаги), `glossary` (параметры и значения), `extending` (как добавить своё), `backlog` (находки развёрнуто). Страница показывает состояние, спека объясняет применение — это не дубли, а разные потребители. Часть синхронности проверяется машиной: пресет без строки в `reference.md` роняет тест (`apps/ui/src/animations/docs.test.ts`).
- **Наткнулся на дыру — заноси её, а не обходи.** Нет модуля под нужное движение, значение недостижимо, правило не решено — запись идёт в реестр находок на странице аудита (видно), развёрнуто — в `docs/animations/backlog.md` (чем грозит и что закроет). Местный обход, о котором никто не узнал, — это то, из-за чего одно движение оказывается написанным трижды.

---

## Architecture Rule

- Networking is **peer-to-peer over WebRTC**, signaled by **PeerJS** — either the public broker (the default) or `apps/peerserver`. There is no game backend.
- Topology is a **star through the host peer**: non-host peers hold one DataChannel to the host, who relays messages to the others.
- **Game state lives on the peers** (browsers). No game rules are evaluated or enforced by any server.
- All P2P code lives in `apps/frontend/src/network/`.

---

## UI Consumption (From Source)

Both `@release/web` and `@release/playground` import `@release/ui` directly from source — no build step required for the library. Vite aliases resolve at dev and build time:

| Import | Resolves to |
|---|---|
| `@release/ui` | `apps/ui/src/index.ts` |
| `@release/ui/animations` | `apps/ui/src/animations/index.ts` |
| `@release/ui/global.css` | `apps/ui/src/design/global.css` |
| `@release/ui/tokens.css` | `apps/ui/src/design/tokens.css` |

These aliases are configured in each app's `vite.config.ts`. TypeScript path aliases in `tsconfig.json` mirror the same mappings.
