export type CategoryId =
  | 'release'
  | 'attack'
  | 'defense'
  | 'protection'
  | 'operation'
  | 'support'
  | 'trigger'
  | 'ai'

export type CardTag =
  | 'lightning'
  | 'sudo'
  | 'cancel'
  | 'unicorn'
  | 'trigger'
  | 'ai'
  | 'combo-source'

export interface Card {
  id: string
  name: string
  category: CategoryId
  deck: 'base' | 'ai'
  art: string
  tags: CardTag[]
  qty: number
}

export interface Category {
  id: CategoryId
  label: string
  accent: string
}

// One paragraph of a card's description.
export interface CardParagraph {
  text: string
  // substrings of `text` to bold — names of other cards, or a sudo prefix
  bold?: string[]
  // callout background: 'sudo' = yellow (Git Operation sudo effect),
  // 'defense' = green (Defense "works against …", whole line bold)
  highlight?: 'sudo' | 'defense'
  // render `text` (e.g. "ИЛИ") as a centred divider — a thin rule to each side
  divider?: boolean
}

// Text shown on a composed card face. Minimal on purpose — fields are added as
// real cards are authored and we learn what each face actually needs.
export interface CardContent {
  // headline on the face (may differ per locale, e.g. transliterated names)
  title: string
  // type / category line under the title
  typeLine: string
  // description body — one or more paragraphs
  paragraphs: CardParagraph[]
  // optional flavour line
  flavor?: string
}

// Both locales for one card, authored together.
export interface LocalizedCardContent {
  ru: CardContent
  en: CardContent
}
