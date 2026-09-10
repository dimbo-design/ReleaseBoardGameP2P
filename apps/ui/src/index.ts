// Data + logic
//
// The animation layer is NOT re-exported here. It is a vocabulary and its steps
// — how a thing moves — rather than a thing to render, so it has its own entry:
//
//   import { play, useFlyer } from '@release/ui/animations'
//
// Keeping it out of this barrel is what makes that a real boundary rather than
// a naming convention: a component cannot drift into the animation layer by
// autocomplete, and the layer's own dependencies stay visible.
export {
  default as PresetAvatar,
  PRESET_AVATARS,
  type PresetAvatarItem,
} from './avatars/PresetAvatar'
export type { ChatCopy, ChatMessage, ChatRole } from './blocks/Chat'
export { default as Chat } from './blocks/Chat'
export { default as GameSettings } from './blocks/GameSettings'
export type { SwitchLang } from './blocks/LangSwitcher'
export { default as LangSwitcher } from './blocks/LangSwitcher'
export type { LobbyCodeCopy } from './blocks/LobbyCode'
export { default as LobbyCode } from './blocks/LobbyCode'
export { default as Menu, MenuButton, MenuGroup } from './blocks/Menu'
export type { PhysicalEditionCopy } from './blocks/PhysicalEdition'
export { default as PhysicalEdition } from './blocks/PhysicalEdition'
export { default as PlayerSlot, EmptySlot } from './blocks/PlayerSlot'
export type { RulesCopy, RulesProps, RulesSection } from './blocks/Rules'
export { default as Rules } from './blocks/Rules'
export type { VideoPlayerCopy, VideoPlayerProps } from './blocks/VideoPlayer'
export { default as VideoPlayer } from './blocks/VideoPlayer'
export { default as Loader } from './boot'
export { buildSequence } from './boot/lines'
export {
  assetUrl,
  CARDS,
  COVERS,
  cardById,
} from './cards/catalogue'
export { CATEGORIES } from './cards/categories'
// The card *type* is re-exported as `CardData` to avoid colliding with the `Card`
// *component* default export below. Internally the type stays named `Card`.
export type { Card as CardData, CardTag, Category, CategoryId } from './cards/types'
export type { GameMode, GameModeCopy, GameModesCopy, Setup } from './game/modes'
export { DEFAULT_SETUP, GAME_MODES } from './game/modes'
export { NICKNAMES, randomNickname, sanitizeNickname } from './game/nicknames'
export { default as GearIcon } from './icons/GearIcon'
export type { Point } from './primitives/Arrow'
export { centerOf, default as Arrow, useArrow } from './primitives/Arrow'
export { default as Avatar } from './primitives/Avatar'
export type { BadgeTone } from './primitives/Badge'
export { default as Badge } from './primitives/Badge'
export type { ButtonProps, ButtonVariant, CopyButtonProps } from './primitives/Button'
export { CopyButton, default as Button } from './primitives/Button'
// Components (added/uncommented as Task 4 migrates each)
// CARD_RATIO rides along with the box helpers: a consumer that aims a flight at
// a card box needs the ratio to reason about the box it gets back.
export { CARD_RATIO, cardAreaOf, cardBoxIn, default as Card } from './primitives/Card'
export { default as CardPair, PAIR_AUX, PAIR_AUX_POSE } from './primitives/CardPair'
export { default as Drawer } from './primitives/Drawer'
export type { DropdownItem } from './primitives/Dropdown'
export { default as Dropdown } from './primitives/Dropdown'
export { default as EdgeGlow } from './primitives/EdgeGlow'
export type { HudBackgroundTone } from './primitives/HudBackground'
export { default as HudBackground } from './primitives/HudBackground'
export { default as HudSurface } from './primitives/HudSurface'
export type { InputHandle, InputProps } from './primitives/Input'
export { default as Input } from './primitives/Input'
export type { MessageProps, MessageRole } from './primitives/Message'
export { default as Message, MessageNote } from './primitives/Message'
export { default as Modal } from './primitives/Modal'
export type { ModeOption } from './primitives/ModeSelect'
export { default as ModeSelect } from './primitives/ModeSelect'
export { default as Overlay } from './primitives/Overlay'
export { default as Pile } from './primitives/Pile'
export type { HeapCard } from './primitives/Pile/Pile'
export { default as RingTimer } from './primitives/RingTimer'
export type { ScrollAreaHandle } from './primitives/ScrollArea'
export { default as ScrollArea } from './primitives/ScrollArea'
export { default as Slider } from './primitives/Slider'
export { default as Spinner } from './primitives/Spinner'
export { default as StatusDot } from './primitives/StatusDot'
export type { TabRailItem } from './primitives/TabRail'
export { default as TabRail } from './primitives/TabRail'
export type { TextareaHandle, TextareaProps } from './primitives/Textarea'
export { default as Textarea } from './primitives/Textarea'
export { default as Toggle } from './primitives/Toggle'
export type {
  TypographyBase,
  TypographyProps,
  TypographyTk,
  TypographyVariant,
} from './primitives/Typography'
export { default as Typography, VARIANTS } from './primitives/Typography'
export type { InviteCopy, InviteState, JoinRole, SlotAvailability } from './screens/Invite'
export { default as Invite } from './screens/Invite'
export { default as Lobby } from './screens/Lobby'
export { default as Start } from './screens/Start'
export type { StartCopy } from './screens/Start/Start'
export type { StatPlayer, StatsCopy } from './screens/Stats'
export { default as Stats } from './screens/Stats'
export type { CardCatalogProps } from './table/CardCatalog'
export { default as CardCatalog } from './table/CardCatalog'
export {
  type CardPreview,
  type CardPreviewSlotProps,
  useCardPreview,
} from './table/CardPreview'
export type { ConfirmActionProps } from './table/ConfirmAction'
export { default as ConfirmAction } from './table/ConfirmAction'
export { default as GameModes } from './table/GameModes'
export { default as GameOver } from './table/GameOver'
export type { GameOverCondition, GameOverCopy } from './table/GameOver/GameOver'
export { default as Hand } from './table/Hand'
export { CARD_W, handStep, type SlotPlacement, slotPlacement } from './table/Hand/fan'
export type { HandCardState, HandItem, HandPlayDrop } from './table/Hand/Hand'
export { default as MoveHistory } from './table/MoveHistory'
export type { HistoryEntry, MoveHistoryCopy } from './table/MoveHistory/MoveHistory'
export { default as Participants } from './table/Participants'
export type { Participant, ParticipantsCopy, Spectator } from './table/Participants/Participants'
export { default as PauseGame } from './table/PauseGame'
export type { PauseGameCopy, PausePlayer } from './table/PauseGame/PauseGame'
export type { ReconnectCopy } from './table/Reconnect'
export { default as Reconnect } from './table/Reconnect'
export { default as ReleaseZone } from './table/ReleaseZone'
export type { ReleaseSlots, ReleaseSupport } from './table/ReleaseZone/ReleaseZone'
export { default as Seat } from './table/Seat'
export type { SeatCopy } from './table/Seat/Seat'
export { default as Table } from './table/Table'
export type { DockView } from './table/Table/dock'
export { deriveDock, isCounting } from './table/Table/dock'
export type {
  TableActions,
  TableChoice,
  TablePending,
  TableTarget,
  TableWindow,
} from './table/Table/intents'
export {
  default as PendingPrompt,
  type PendingPromptCopy,
  type PendingPromptProps,
  type WindowCopy,
} from './table/Table/PendingPrompt'
export { PILE_WIDTH, pileWidthFor } from './table/Table/piles'
export type {
  Panel,
  TableChromeCopy as TableCopy,
  TableCopyBundle,
  TableOpponent,
  TableOver,
  TableProps,
  TableRoom,
  TableSlots,
  TableState,
} from './table/Table/types'
// The line under the centre — where the table says what it is waiting for. It
// hangs off CENTRE_TOP, so it ships beside the geometry it follows.
export { default as AskLine } from './table/TableCentre/AskLine'
export {
  CENTRE_CARD_W,
  CENTRE_SETS,
  CENTRE_SLOTS,
  CENTRE_TOP,
  type CentrePlace,
  type CentreSet,
  type CentreSlot,
  type CentreSlotGeom,
  type CentreTilt,
  centrePlaceStyle,
  centreTransform,
} from './table/TableCentre/centre'
export {
  GRID_CARD_W,
  GRID_GAP,
  GRID_TOP,
  type GridCell,
  type GridShape,
  gridCardW,
  gridCells,
  gridOf,
} from './table/TableCentre/discardGrid'
export type { TurnDockCopy, TurnDockState } from './table/TurnDock/TurnDock'
export { default as TurnDock } from './table/TurnDock/TurnDock'
