import { type ReactNode, useState } from 'react'
import { type Lang, useLang } from '../../Playground/lang'
import styles from './AnimationAuditStory.module.css'

// ANIMATION AUDIT — the source of state for animation work (a map, not an
// interactive demo). Three tables:
//   1. Ready modules — building blocks (animation atoms), with statuses.
//   2. Scenario combinations — how the blocks assemble for game situations.
//      A scenario is a sequence, not a module: it isn't formalized separately,
//      so it has NO statuses, only what is already implemented.
//   3. Needs rework — where it's off, with statuses (rework / reuse).
// Change the animations — update this page.
//
// Language: technical names (module ids, file paths, rect/FLIP/move/fade/DOM…)
// stay English in both languages; descriptive prose is bilingual via useLang().
type Loc = Record<Lang, string>
type Status = 'ok' | 'rework' | 'reuse' | 'open'

const STATUS: Record<Status, { cls: string; label: Loc }> = {
  ok: { cls: styles.ok, label: { ru: 'оформлено', en: 'done' } },
  rework: { cls: styles.rework, label: { ru: 'доработать', en: 'rework' } },
  reuse: { cls: styles.reuse, label: { ru: 'есть готовое', en: 'reuse' } },
  open: { cls: styles.open, label: { ru: 'нет решения', en: 'undecided' } },
}

interface Module {
  mod: string
  what: Loc
  where: Loc
  status: Status
}
interface Scenario {
  name: Loc
  from: Loc
  // Сторона кита: сцена или компонент, где движение показано и отлаживается.
  where: string
  // Сторона борда: модуль фронтенда, который играет эту хореографию от настоящих
  // событий движка; несколько — через запятую, как и на стороне кита (у дока
  // там четыре компонента в одном поле). Сценарий здесь — игровая СИТУАЦИЯ, а
  // не модуль: если фронтенд разложил её на два файла, это факт про раскладку
  // файлов, а не повод разделить запись. Пусто — значит хореография живёт
  // только в плейграунде.
  // Поле обязано быть отдельным, а не строкой внутри описания: «доехало ли до
  // доски» — это состояние работы, то самое, ради которого страница и заведена,
  // и молчание в общем тексте читается тремя разными способами сразу («ещё нет»,
  // «есть, но не записали», «туда и не поедет»). Путь проверяется тестом
  // (stories/docs.test.ts) — иначе он устареет первым же переносом файла.
  board?: string
}
interface Issue {
  what: Loc
  problem: Loc
  where: Loc
  status: Status
}

// ===== 1. Ready modules — building blocks =====
const MODULES: Module[] = [
  {
    mod: 'move()',
    what: {
      ru: 'Базовый travel: перелёт из rect в rect — translate по центрам + scale по ширине + финальные rotate/dx/dy. Основа всех полётов карт.',
      en: 'Base travel: a flight from rect to rect — translate by centers + scale by width + final rotate/dx/dy. The foundation of every card flight.',
    },
    where: { ru: 'animations/presets.ts (внутр.)', en: 'animations/presets.ts (internal)' },
    status: 'ok',
  },
  {
    mod: "play('flipCard')",
    what: {
      ru: 'Переворот карты лицо↔рубашка (rotateY).',
      en: 'Card flip face↔back (rotateY).',
    },
    where: { ru: 'словарь → Card', en: 'registry → Card' },
    status: 'ok',
  },
  {
    mod: "play('shake')",
    what: {
      ru: 'Тряска влево-вправо — «не годится»: поле не заполнено, карты нет в руке. Разовый триггер по событию (как flipCard), с возвратом в исходную точку. Три параметра, каждый про своё: amp — размах первого рывка в px, dur — время, shape — ХАРАКТЕР (доли размаха по кадрам, SHAKE_SHAPES). Характеров два: settle — рывок и успокоение (жест поля ввода, по умолчанию 7px/380ms), spring — два полных размаха и два поменьше (крупный элемент, вздрогнувший всем собой). Доли, а не пиксели, поэтому характер читается одинаково на любой силе.',
      en: 'Left-right shake — "this will not do": an empty field, a card that is not in the hand. A one-shot event trigger (like flipCard), returning to the start point. Three parameters, each its own thing: amp — the first swing in px, dur — the time, shape — the CHARACTER (fractions of the swing per frame, SHAKE_SHAPES). Two characters: settle — a jolt and a calm-down (the input-field gesture, 7px/380ms by default), spring — two full swings then two smaller ones (a large element that flinched whole). Fractions, not pixels, so a character reads the same at any force.',
    },
    where: {
      ru: 'словарь → Input (сам примитив), Invite, Start (модалка входа), Form во фронтенде; spring — веер соперника в PickSpecific',
      en: 'registry → Input (the primitive itself), Invite, Start (entry modal), Form in the frontend; spring — the opponent fan in PickSpecific',
    },
    status: 'ok',
  },
  {
    mod: "play('playToCenter')",
    what: {
      ru: 'Выкладывание карты в центр стола (move, 480/ease).',
      en: 'Playing a card to the table center (move, 480/ease).',
    },
    where: {
      ru: 'словарь → CardPlay, DeckAnimations, Combo, HandLimit, AiCards, Error503, DefenseRelease',
      en: 'registry → CardPlay, DeckAnimations, Combo, HandLimit, AiCards, Error503, DefenseRelease',
    },
    status: 'ok',
  },
  {
    mod: "play('playToReleaseZone')",
    what: {
      ru: 'Карта в слот зоны релиза (move, 480, кривая LAND). LAND — приземление КАРТЫ: путь по столу виден, доезд мягкий. Раньше здесь стояла SNAP, та же кривая, что у появления бейджа: на 260ms она читается как «встало», а на 480 съедала почти весь путь в первой трети, и релиз в зону выглядел броском.',
      en: 'A card into a release-zone slot (move, 480, the LAND curve). LAND is a CARD landing: the travel across the table is seen and the arrival is soft. It used to be SNAP — the same curve as a badge appearing, which reads as «it is there» over 260ms but ate almost the whole path in the first third over 480, so a release into its zone looked thrown.',
    },
    where: {
      ru: 'словарь → Combo, AiCards, DefenseRelease, GameEnd',
      en: 'registry → Combo, AiCards, DefenseRelease, GameEnd',
    },
    status: 'ok',
  },
  {
    mod: "play('centerToDiscard')",
    what: {
      ru: 'Из центра в сброс с разворотом и разбросом (move, 420).',
      en: 'From the center to the discard with a turn and scatter (move, 420).',
    },
    where: {
      ru: 'словарь → только через useDiscardExit (сцены его не зовут напрямую)',
      en: 'registry → through useDiscardExit only (no scene calls it directly)',
    },
    status: 'ok',
  },
  {
    mod: "play('flyFrom')",
    what: {
      ru: 'FLIP-вылет: элемент уже на новом месте, анимируем его «из» прошлого rect в текущую позицию. Появление новой колоды/карты из источника.',
      en: 'FLIP fly-in: the element is already in its new place, we animate it "from" the previous rect to the current position. A new deck/card appearing from a source.',
    },
    where: {
      ru: 'словарь → DeckAnimations, Animations',
      en: 'registry → DeckAnimations, Animations',
    },
    status: 'ok',
  },
  {
    mod: "play('gatherToDeck')",
    what: {
      ru: 'Стопка летит к целевой стопке и приземляется (сброс → новая колода). move, центр-в-центр.',
      en: 'A pile flies to the target pile and lands (discard → new deck). move, center-to-center.',
    },
    where: { ru: 'словарь → DeckAnimations', en: 'registry → DeckAnimations' },
    status: 'ok',
  },
  {
    mod: "play('absorbToDeck')",
    what: {
      ru: 'Поглощение: стопка/колода летит в целевую и растворяется по ходу (слияние колод). move + fade.',
      en: 'Absorption: a pile/deck flies into the target and dissolves along the way (merging decks). move + fade.',
    },
    where: { ru: 'словарь → DeckAnimations', en: 'registry → DeckAnimations' },
    status: 'ok',
  },
  {
    mod: "play('drawToCenter')",
    what: {
      ru: 'Карта выходит из колоды добора в центр стола. Отдельно от playToCenter — у добора своя вариативность (число карт, спец-механики).',
      en: 'A card comes out of the draw deck to the table center. Separate from playToCenter — drawing has its own variability (card count, special mechanics).',
    },
    where: {
      ru: 'словарь → DrawCard, AiCards, Error503, GameDeal, useFlyer',
      en: 'registry → DrawCard, AiCards, Error503, GameDeal, useFlyer',
    },
    status: 'ok',
  },
  {
    mod: "play('dealToSeat')",
    what: {
      ru: 'Карта из центра уходит к месту игрока и растворяется в скрытой руке (move + fade).',
      en: 'A card leaves the center for a player seat and dissolves into the hidden hand (move + fade).',
    },
    where: { ru: 'словарь → DrawCard, GameDeal', en: 'registry → DrawCard, GameDeal' },
    status: 'ok',
  },
  {
    mod: "play('returnToDeck')",
    what: {
      ru: 'Карта возвращается из центра обратно в колоду (центр→колода) с уменьшением до размера колоды. Парный к drawToCenter.',
      en: 'A card returns from the center back to the deck (center→deck), shrinking to the deck size. The pair of drawToCenter.',
    },
    where: {
      ru: 'словарь → DrawCard, AiCards, CherryPick, Rebase',
      en: 'registry → DrawCard, AiCards, CherryPick, Rebase',
    },
    status: 'ok',
  },
  {
    mod: 'useArrow() + centerOf()',
    what: {
      ru: 'Геометрия адресной стрелки: точки from/to, слежение за курсором, старт/стоп.',
      en: 'Targeting-arrow geometry: from/to points, cursor tracking, start/stop.',
    },
    where: {
      ru: 'primitives/Arrow → Arrow, Combo, DeckAnimations',
      en: 'primitives/Arrow → Arrow, Combo, DeckAnimations',
    },
    status: 'ok',
  },
  {
    mod: 'CardPair + PAIR_AUX_POSE',
    what: {
      ru: 'Визуальный атом пары: вспомогательная карта подтыкается под основную под углом. Поза объявлена ОДИН раз и ДАННЫМИ — PAIR_AUX { rot, dy }, а CSS-строка PAIR_AUX_POSE выводится из них: читателей трое и формы им нужны разные. Компонент ставит строку инлайном, складывание садится на неё финальным кадром, а шаг ухода в сброс берёт угол числом — при распаде пары половина улетает своим полётом и должна стартовать с того наклона, который был виден. Тот же приём, что Scatter + restTransform() у кучи: поза — значение, CSS — её представление.',
      en: 'The visual atom of a pair: a helper card tucks under the main one at an angle. The pose is declared ONCE and as DATA — PAIR_AUX { rot, dy } — with the CSS string PAIR_AUX_POSE derived from it: there are three readers and they need different forms. The component applies the string inline, the fold lands on it as its final frame, and the discard-exit step takes the angle as a number — when a pair splits, the half flying out on its own must start at the tilt it was seen at. The same trick as Scatter + restTransform() for the heap: the pose is a value, the CSS is its representation.',
    },
    where: {
      ru: 'primitives/CardPair → Combo, DefenseRelease, Error503, ReleaseZone, useDiscardExit',
      en: 'primitives/CardPair → Combo, DefenseRelease, Error503, ReleaseZone, useDiscardExit',
    },
    status: 'ok',
  },
  {
    mod: "play('foldIntoPair') / enterPose()",
    what: {
      ru: 'Две карты СКЛАДЫВАЮТСЯ в пару: каждая половина приезжает из своего настоящего места на столе в свою позу внутри пары (у основной — рамка, у вспомогательной — PAIR_AUX_POSE, с snap-приземлением). Отличается от travel-пресетов тем, что пара никуда не летит: двигаются только внутренние узлы data-main / data-aux. enterPose(from, box) — вход FLIP-полёта отдельным хелпером, потому что сцена красит им первый кадр ДО старта: иначе половины успевают мигнуть в конечной позе.',
      en: 'Two cards FOLD into a pair: each half arrives from where it actually stands on the table into its pose inside the pair (the main one — the frame, the aux — PAIR_AUX_POSE with a snap landing). Unlike the travel presets the pair does not fly anywhere: only the inner data-main / data-aux nodes move. enterPose(from, box) is the FLIP entry pose as its own helper, because the scene paints the first frame with it BEFORE the start — otherwise the halves flash in their final pose.',
    },
    where: {
      ru: 'словарь → карточка пресета на странице Animations; сам жест вокруг него — шаг usePairFold(), через который идут Combo и DefenseRelease',
      en: 'registry → the preset card on the Animations page; the gesture around it is the usePairFold() step, which Combo and DefenseRelease go through',
    },
    status: 'ok',
  },
  {
    mod: 'EdgeGlow',
    what: {
      ru: 'Краевое свечение контейнера внутрь (инсет-вуаль) с плавным fade появления/затухания (CSS-transition). Два варианта силы: strong (стол игрока) / weak (место соперника). Цвет/интенсивность — пропсами.',
      en: 'Inward edge glow of a container (inset veil) with a smooth fade in/out (CSS-transition). Two strength variants: strong (player table) / weak (opponent seat). Color/intensity via props.',
    },
    where: {
      ru: 'primitives/EdgeGlow → DrawCard и Error503 (тревога 503), AiCards, UI KIT',
      en: 'primitives/EdgeGlow → DrawCard and Error503 (the 503 alarm), AiCards, UI KIT',
    },
    status: 'ok',
  },
  {
    mod: 'scatterAt() / restTransform() / toDiscardParams()',
    what: {
      ru: 'Единый источник «как карта ложится и лежит в куче сброса». Разброс (угол + смещение долями ширины карты) считается ОДИН раз по ключу карты (scatterAt — детерминирован, стабилен между ре-рендерами и пирами); полёт (toDiscardParams) и покой (restTransform) читают его же → карта приземляется ровно туда, где лежит, без подмены позиции в финале. jitter() — разовый случайный вариант. HEAP_SHOW — сколько верхних карт видно, нижние гаснут. Аналог slotPlacement() для веера руки.',
      en: 'The single source of "how a card lands in and rests in the discard heap". Scatter (tilt + offset as fractions of card width) is computed ONCE by card key (scatterAt — deterministic, stable across re-renders and peers); the flight (toDiscardParams) and the rest (restTransform) read the same one → a card lands exactly where it rests, no position swap on the last frame. jitter() is the one-off random variant. HEAP_SHOW — how many top cards stay visible, the rest fade. The discard counterpart of slotPlacement() for the hand fan.',
    },
    where: {
      ru: 'animations/scatter → useDiscardExit (значит все сцены со сбросом) + напрямую CherryPick, Combo, CardPlay, DeckAnimations, Error503, DefenseRelease, GameDeal, GameEnd',
      en: 'animations/scatter → useDiscardExit (hence every scene with a discard) + directly CherryPick, Combo, CardPlay, DeckAnimations, Error503, DefenseRelease, GameDeal, GameEnd',
    },
    status: 'ok',
  },
  {
    mod: 'cardBoxIn() / cardAreaOf() / CARD_RATIO',
    what: {
      ru: 'Прицел полёта: карточная КОРОБКА внутри чужого прямоугольника. Место соперника, ячейка колоды, сидушка — шире карты и другой пропорции, и целиться в них целиком нельзя: карта раздулась бы до их ширины. cardBoxIn(rect, width) вписывает коробку заданной ширины по центру; cardAreaOf(cell) берёт ширину ячейки и достраивает высоту по CARD_RATIO (1.4) — единственному месту, где это отношение объявлено. Отвечает на «куда лететь», ровно как scatter отвечает на «как лечь».',
      en: 'The aim of a flight: the card BOX inside somebody else’s rectangle. An opponent seat, a deck cell, a seat plate — all wider than a card and of another proportion, and aiming at them whole is wrong: the card would inflate to their width. cardBoxIn(rect, width) centres a box of the given width inside; cardAreaOf(cell) takes the cell width and derives the height from CARD_RATIO (1.4) — the one place that ratio is declared. It answers "where to fly", exactly as scatter answers "how to lie".',
    },
    where: {
      ru: 'primitives/Card/geometry → useDiscardExit, useHandArrival, CardPlay, DrawCard, GameDeal, DefenseRelease, Error503, AiCards, OpponentTakes, DeckAnimations, Combo, Rebase',
      en: 'primitives/Card/geometry → useDiscardExit, useHandArrival, CardPlay, DrawCard, GameDeal, DefenseRelease, Error503, AiCards, OpponentTakes, DeckAnimations, Combo, Rebase',
    },
    status: 'ok',
  },
  {
    mod: 'nextFrames()',
    what: {
      ru: 'Двойной requestAnimationFrame — дождаться отрисовки нового узла перед стартом анимации.',
      en: 'A double requestAnimationFrame — wait for the new node to paint before starting the animation.',
    },
    where: {
      ru: 'animations/timing → useFlyer, useHandArrival, useDiscardExit (значит под каждым полётом), Combo, AiCards, DeckAnimations, DefenseRelease',
      en: 'animations/timing → useFlyer, useHandArrival, useDiscardExit (hence under every flight), Combo, AiCards, DeckAnimations, DefenseRelease',
    },
    status: 'ok',
  },
  {
    mod: 'wait(ms)',
    what: {
      ru: 'Пауза-таймер для держания фаз между анимациями.',
      en: 'A pause timer to hold phases between animations.',
    },
    where: {
      ru: 'animations/timing → 12 сцен и все три хука полёта',
      en: 'animations/timing → 12 scenes and all three flight hooks',
    },
    status: 'ok',
  },
  {
    mod: 'slotPlacement() / handStep() / insertPath()',
    what: {
      ru: 'Единый источник геометрии веера руки: наклон, дуга, ширина и шаг-от-кол-ва карт. Раскладка слотов в Hand и приземление вставки считаются по ОДНОЙ формуле — без копий, которые разъезжаются при тюнинге. Здесь же правило ВХОДА в веер (insertPath): карта заходит в свой слот в обход СЛЕВА, одной кривой без излома, чтобы смену слоя (карта перестаёт быть верхней и становится зажатой между двумя) можно было сделать на вершине обхода — там, где полоса перекрытия с правой соседкой минимальна, и на движении. Вылет — в шагах веера, место на дуге читается по высоте отпускания. У последнего слота соседа справа нет: заход обращается в ноль, кривая становится прямой.',
      en: 'The single source of hand-fan geometry: tilt, arc, width and step-from-card-count. The slot layout in Hand and the insert landing are computed by ONE formula — no copies that drift apart under tuning. The rule for ENTERING the fan lives here too (insertPath): a card comes into its slot round from the LEFT, along one curve with no corner in it, so the layer switch (it stops being the top card and becomes one held between two) can be made at the apex — where the strip it overlaps its right neighbour by is smallest, and while it moves. The reach is in fan steps; where on the arc is read off the release height. The last slot has no right neighbour: the reach collapses to zero and the curve is a straight line.',
    },
    where: {
      ru: 'table/Hand/fan → Hand, useHandArrival',
      en: 'table/Hand/fan → Hand, useHandArrival',
    },
    status: 'ok',
  },
  {
    mod: 'useHandArrival()',
    what: {
      ru: 'Карты ПРИХОДЯТ в руку — одно движение на любое их число. Раньше это были два шага («карта встаёт в руку» и «сборка возвращается»), а на экране движение одно: веер раздвигает зазор в СЕРЕДИНЕ, карта подгоняет размер, садится на нижний центр слота и подтыкается под веер. Источник любой: прямоугольник; карта, лежащая с наклоном (пивот компенсируется, первый кадр не дёргается); уже нарисованный элемент (шаг сам убирает его с экрана); половина пары (по своему якорю, наклонённая рамка обрезается — I6). Форма посадки — не его: карта входит в веер по insertPath, тем же правилом, каким рука кладёт обратно перетащенную, потому что встать между двух карт — одна ситуация, чем бы карту туда ни принесли. На приземлении отдаёт НАЗАД то, что прилетело: сцена не читает свою выкладку, которую к тому моменту уже очистила (I8).',
      en: 'Cards ARRIVE in the hand — one movement for any number of them. It used to be two steps ("a card settles in" and "the staging comes back"), but on screen the movement is one: the fan opens a gap in the MIDDLE, the card matches the size, lands on the slot bottom-centre and tucks under the fan. Any source: a rect; a card resting at a tilt (the pivot is compensated, so the first frame does not jump); an element already drawn (the step takes it off screen itself); one half of a pair (measured off its anchor, the tilted box trimmed — I6). The shape of the landing is not its own: the card comes into the fan along insertPath, the same rule the hand puts a dragged card back by, because going in between two cards is one situation whatever carried the card there. On landing it hands BACK what arrived: the scene does not read its own staging, which it cleared the moment the flight started (I8).',
    },
    where: {
      ru: 'stories/interactive → 11 сцен: добор, карта соперника (обе сцены выбора), Inside, Cherry-pick, System Upgrade, отмены в Combo и DeckAnimations, Rollback, раздача в GameDeal, CardToHand как витрина самого шага',
      en: 'stories/interactive → 11 scenes: draws, an opponent card (both picking scenes), Inside, Cherry-pick, System Upgrade, the undos in Combo and DeckAnimations, Rollback, the deal in GameDeal, CardToHand as the showcase of the step itself',
    },
    status: 'ok',
  },
  {
    mod: 'useDiscardExit()',
    what: {
      ru: 'Карты уходят со стола в сброс: по одной, но ВСЕ СРАЗУ — одновременность и читается как «стопка ушла». Пара распадается на две одиночки, каждая летит из своего настоящего места. Один разброс на карту ведёт и полёт, и покой (I7). Наклон стола раскручивается В ПОЛЁТЕ. Слой со стола едет с картой и решает порядок добавления в кучу — снизу вверх (I9). Умеет: свой разброс (карта возвращается на своё место), растворение (уходит под видимый верх кучи), стаггер, и полёт уже существующим элементом вместо своего флаера.',
      en: 'Cards leave the table for the discard: one by one but ALL AT ONCE — the simultaneity is what reads as "the pile went to the discard". A pair splits into two singles, each flying from where it actually stands. One scatter per card drives both its flight and its rest (I7). The table tilt unwinds IN FLIGHT. The layer a card had travels with it and decides the order it joins the heap — bottom-up (I9). Supports: a card\'s own scatter (going back to its place), fading (sinking under the visible top), a stagger, and flying an element that already exists instead of raising a flyer.',
    },
    where: {
      ru: '@release/ui/animations → все 10 сцен со сбросом + борд фронтенда',
      en: '@release/ui/animations → all 10 scenes with a discard + the frontend board',
    },
    status: 'ok',
  },
  {
    mod: 'CENTRE_SLOTS / CENTRE_SETS / centrePlaceStyle()',
    what: {
      ru: 'Единый источник геометрии ЦЕНТРА стола — то же, чем fan.ts является для веера. Центр это не блок с содержимым, а набор ИМЕНОВАННЫХ МЕСТ: куда встаёт разыгранный релиз, где открыто лежит его цена, куда прилетает атака, что накрывает её сверху, где стоит вскрытый триггер и его эффект. Пустое место выглядит как ничто, поэтому его легко описать дважды — сцена рисовала свои координаты в CSS, борд такие же рядом, и совпадали они вручную. CENTRE_TOP (42%) одна на все сцены, у места свой сдвиг и своя ширина (эффект AI шире прочих — 200), а НАБОР по игровой ситуации записывает, ложится ли карта на это место ровно или под своим углом, и слой — только там, где места реально перекрываются. Угла здесь нет и не будет: наклоны детерминированно случайные (scatterAt), и место, диктующее позу, схлопнуло бы их в один угол на всех.',
      en: 'The single source of the CENTRE geometry — what fan.ts is for the hand. The centre is not a block with content but a set of NAMED PLACES: where a played release stands, where its price lies in the open, where an attack lands, what covers it, where a revealed trigger and its effect stand. An empty place looks like nothing, which is why it was easy to describe twice — the scene drew its coordinates in CSS, the board drew the same ones beside it, and they matched by hand. CENTRE_TOP (42%) is one value for every scene, a place carries its own offset and width (the AI effect is wider than the rest — 200), and the SET, one per game situation, records whether a card lies there square or at its own angle, plus a layer only where places actually overlap. There is no angle here and never will be: the tilts are deterministically random (scatterAt), and a place dictating a pose would collapse them into one angle for everyone.',
    },
    where: {
      ru: 'ui: table/TableCentre/centre.ts → 6 интерактивных сцен (CardPlay, Error503, DrawCard, GameDeal, AiCards, DefenseRelease) + страницы Table centre и Ask line; сюда же AskLine — строка, которой стол говорит, висящая под центром',
      en: 'ui: table/TableCentre/centre.ts → 6 interactive scenes (CardPlay, Error503, DrawCard, GameDeal, AiCards, DefenseRelease) + the Table centre and Ask line pages; AskLine belongs here too — the line the table speaks with, hanging under the centre',
    },
    status: 'ok',
  },
  {
    mod: 'usePairFold()',
    what: {
      ru: "Две карты становятся ПАРОЙ на столе — жест целиком, а не кирпич под ним. play('foldIntoPair') складывает одну половину; вокруг него каждый раз писались одни и те же шесть строк (поднять носитель с CardPair, покрасить обе половины позами их настоящих мест, подождать кадр, сложить обе разом) — и таких мест было четыре: сцена и три на борде. Обе половины стартуют оттуда, где карта действительно лежит; вспомогательная приземляется ровно в PAIR_AUX_POSE, поэтому передача готовой пары статичному рендеру не видна. Узел ОСТАЁТСЯ поднятым до release() — снять его раньше значит мигнуть парой между последним кадром и покоем. Слепое пятно флаерной формы закрыто: пара монтируется невидимой и открывается в тот же тик, когда половинам проставлены входные позы, так что кадра «уже сложена» не существует.",
      en: "Two cards become a PAIR on the table — the whole gesture, not the brick under it. play('foldIntoPair') folds ONE half; around it the same six lines were written every time (raise a carrier holding a CardPair, paint both halves at the poses of their real places, wait a frame, fold both at once) — and there were four such places: the scene and three on the board. Both halves start from where the card actually lies; the aux lands exactly on PAIR_AUX_POSE, so handing the finished pair to a static render is invisible. The node STAYS up until release() — dropping it earlier blinks the pair between the last frame and the rest. The flyer form's blind spot is closed: the pair mounts invisible and is revealed in the same tick its halves get their entry poses, so the \"already folded\" frame does not exist.",
    },
    where: {
      ru: '@release/ui/animations → DefenseRelease (защита + судо); борду предстоит заменить три свои копии вызовом',
      en: '@release/ui/animations → DefenseRelease (a defence + its sudo); the board has three copies of its own left to replace with the call',
    },
    status: 'ok',
  },
  {
    mod: 'BoardAnchors',
    what: {
      ru: 'Реестр узлов борда: во что целится полёт и откуда стартует. Блоки HUD, discardBox, centre, hand, плюс seatBox(player) — карточная коробка по центру сидушки (I6, сидушка сильно шире карты), pileBox(index)/bindPile(index, el) — коробка стопки добора по индексу, которым движок называет её в `drawn.pile`, handSlotAt(index) и releaseSlot(player, slot). Только DOM: своего состояния не держит и чужое не зеркалит — потому карта в руке достаётся по индексу, а не по uid (иначе реестр зависел бы от той самой руки, от которой должен быть независим). Слот релиза всегда ищется под владельцем: frontend есть у каждого игрока. Одна идентичность на всю жизнь монтирования — потребители забирают реестр в ref внутрь долгих последовательностей.',
      en: "The board's registry of nodes: what a flight aims at and where it starts. The HUD blocks, discardBox, centre, hand, plus seatBox(player) — a card box centred on a seat (I6, a seat is far wider than a card), pileBox(index)/bindPile(index, el) — a draw pile's card box, keyed by the index the engine names in `drawn.pile`, handSlotAt(index) and releaseSlot(player, slot). DOM only: it holds no game state and mirrors none, which is why a hand card is reached by index rather than by uid (a uid lookup would make the registry depend on the very hand it must be independent of). A release slot is always looked up under its owner: every player has a frontend. One identity for the life of the mount — consumers capture it into a ref inside long-running sequences.",
    },
    where: {
      ru: 'frontend: entities/game/board/anchors.ts → раздача, очередь тактов',
      en: 'frontend: entities/game/board/anchors.ts → the deal, the beat queue',
    },
    status: 'ok',
  },
  {
    mod: 'planBeats() + useBeats()',
    what: {
      ru: 'Очередь тактов борда. События приходят с провода ПАЧКАМИ — за один синк может приехать несколько ходов, — поэтому борд, который анимировал бы на рендер, играл бы их поверх друг друга или ронял все, кроме последней. Такт играет по одному; пока он идёт, борд рисует ТЕНЬ — ту проекцию, ОТ которой такт уходит, а не ту, к которой приходит (к моменту эффекта live уже без карты, вместе с её слотом — I1). Пачка, приехавшая посреди такта, ждёт своей очереди, а не планируется против состояния, которого никто не видел. Событие без хореографии не даёт такта и проходит насквозь. Тень живёт ровно столько, сколько очередь: на опустошении она снимается и живая проекция побеждает всегда — даже если такт упал. Здесь же единственная проверка prefers-reduced-motion: play() её не делает.',
      en: "The board's beat queue. Events arrive off the wire in BATCHES — several moves can land in one sync — so a board that animated on render would play them on top of each other or drop all but the last. One beat at a time; while it runs the board draws a SHADOW — the projection the beat moves AWAY from, not the one it arrives at (by effect time `live` is already without the card, and without its slot — I1). A batch arriving mid-beat waits its turn rather than being planned against a state nobody saw. An event with no choreography yields no beat and passes through. The shadow lives exactly as long as the queue: on drain it is dropped and the live projection always wins — even if a beat threw. This is also the single prefers-reduced-motion check, because play() does not make one.",
    },
    where: {
      ru: 'frontend: features/board-beats/ → уход карты в сброс; раздача как такт ноль',
      en: 'frontend: features/board-beats/ → a card leaving for the discard; the deal as beat zero',
    },
    status: 'ok',
  },
  {
    mod: 'useFlyer()',
    what: {
      ru: 'ПЕРЕВОЗЧИК — та половина полёта, которая не правило. Под каждым полётом один и тот же узел: закреплённая карта над столом. Его писали заново в каждой сцене, а вместе с ним пять инвариантов, и каждый хоть раз ломался: рисоваться там, где смонтировался (I10 — иначе вспышка внизу страницы), свежий узел на полёт (I5), прокраска у источника (I2), гашение остатков анимаций (I3), прикол после посадки (I4). Умеет нести не только карту: пару, карту в беглом чтении, карту в морфе — содержимое остаётся сценовым, узел общий. Не знает, куда лететь и каким пресетом. I4 сцена вправе не применять: если поза приземления живёт в залитой анимации, прикол её погасит.',
      en: "THE CARRIER — the half of a flight that is not the rule. Under every flight there is the same node: a fixed card over the table. It was written from scratch per scene, and with it five invariants, each broken at least once: paint where it MOUNTS (I10 — else a flash at the bottom of the page), a fresh node per flight (I5), a painted frame at the source (I2), leftover animations cancelled (I3), the pin after landing (I4). It can carry more than a card — a pair, a card in its at-a-glance reading, a card mid-morph: the content stays the scene's, the node is shared. It does not know where to fly or which preset. A scene may decline I4: if the landing pose lives in a filled animation, pinning would cancel it.",
    },
    where: {
      ru: 'stories/interactive → все сцены с полётами',
      en: 'stories/interactive → every scene with flights',
    },
    status: 'ok',
  },
  {
    mod: 'Pile (heap)',
    what: {
      ru: 'Сброс как наброшенная КУЧА, а не ровная стопка: карты лежат каждая со своим разбросом (scatterAt/restTransform), под ними «глубина» стопки — и она показывается только когда под видимыми картами реально что-то есть. Отдаёт наружу коробку карты (boxRef) — в неё целятся полёты, и собранное состояние (gathered) — когда сброс превращается в колоду. Два состояния выбора, как у карты в руке: pickable — спокойная обводка «сюда можно» (идёт выбор, целей несколько), selected — свечение в цвете под курсором. Счётчик стоит на ступень ВЫШЕ полёта: прилетающая карта проходит под ним, а не накрывает и потом ныряет вниз — поэтому место стопки на столе нельзя центрировать трансформом (он запер бы бейдж внутри).',
      en: "The discard as a tossed HEAP, not a neat stack: every card lies at its own scatter (scatterAt/restTransform), with the pile depth beneath — shown only when something is actually hidden under the visible cards. Exposes the card box (boxRef) for flights to aim at, and the gathered state for when the discard turns into a deck. Two pick states, like a hand card: pickable — a calm outline meaning 'this one can be picked' (a choice is open and there are several targets), selected — the accent glow under the cursor. The counter sits one rung ABOVE the flight: an arriving card passes under it instead of covering it and then dropping beneath — which is why a pile's place on the table must not be centred with a transform (that would trap the badge inside the wrapper).",
    },
    where: {
      ru: 'primitives/Pile → Table + все сцены',
      en: 'primitives/Pile → Table + every scene',
    },
    status: 'ok',
  },
  {
    mod: "play('rollOut' / 'rollIn')",
    what: {
      ru: 'Подмена содержимого слота чистым фейдом по opacity — БЕЗ движения. dur — длительность; delay (только у in) держит новое невидимым, пока старое не ушло (последовательное появление имени). Оркестрируется компонентом Swap: живой слой в потоке + уходящий абсолютом поверх (без сетки).',
      en: 'Swap a slot’s content with a plain opacity fade — NO movement. dur — duration; delay (in only) holds the incoming invisible until the outgoing clears (sequential name entrance). Orchestrated by the Swap component: a live layer in flow + the outgoing one absolutely overlaid (no grid).',
    },
    where: { ru: 'словарь → TurnDock/Swap', en: 'registry → TurnDock/Swap' },
    status: 'ok',
  },
  {
    mod: "play('popIn' / 'popOut')",
    what: {
      ru: 'Появление/уход маленького элемента в зарезервированном слоте (fade + масштаб), без сдвига соседей. Оркестрируется компонентом Reveal.',
      en: 'Appear/disappear of a small element in a reserved slot (fade + scale), without shifting neighbours. Orchestrated by the Reveal component.',
    },
    where: {
      ru: 'словарь → TurnDock/Reveal («drawn»-бейдж)',
      en: 'registry → TurnDock/Reveal (the “drawn” badge)',
    },
    status: 'ok',
  },
  {
    mod: 'Hand (canonical)',
    what: {
      ru: 'Интерактивный веер: ховер (подъём + расступание + отдельный зум-превью), взять-потянуть (наружу — розыгрыш, внутри — перестановка), порог клик/drag, посадка обратно с transform-origin bottom-center. Карта берётся оттуда, где НАРИСОВАНА (с подъёмом от ховера), и уносит на летящий слой наклон, который на ней был, — иначе она проваливалась бы на высоту подъёма и выпрямлялась в один кадр. Кладётся обратно по insertPath: сам обход — правило веера, руке принадлежат часы (SETTLE_MS, SETTLE_EASE, SWITCH_AT). Всё внутри компонента; наружу — данные и колбэки намерения (onPlay/onReorder/onCardClick/stateAt).',
      en: 'The interactive fan: hover (lift + spread + a separate zoom preview), pick-up & drag (out → play, inside → reorder), a click/drag threshold, the landing back with transform-origin bottom-center. A card is picked up from where it is DRAWN (hover lift included) and carries the tilt it had onto the drag layer — otherwise it dropped by the height of that lift and cut to flat in one frame. It is put back along insertPath: the sweep belongs to the fan, the clock to the hand (SETTLE_MS, SETTLE_EASE, SWITCH_AT). All internal; the consumer supplies data and intent callbacks (onPlay/onReorder/onCardClick/stateAt).',
    },
    where: { ru: 'table/Hand → все руки', en: 'table/Hand → every hand' },
    status: 'ok',
  },
  {
    mod: 'CardCatalog',
    what: {
      ru: 'Каталог выбора карты: набор карт лицом вверх, из которого называют одну. Не веер и не куча — карты разложены, чтобы их прочитали и сравнили, поэтому по ховеру ячейка ВЫРАСТАЕТ до читаемого размера, а не поднимается. Жизнь каталога — два пропса: open (выбор идёт: все ячейки живые) и chosen (названная держится увеличенной, пока остальные уезжают вниз); selected — то, на чём выбор заряжен, но ещё не подтверждён. Появление — стаггером по ячейкам. Подтверждение снаружи, обычно ConfirmAction: назвать карту необратимо. ГДЕ каталог стоит — дело сцены, блок занимает выданную область.',
      en: 'The card-pick catalog: a set of face-up cards to name one from. Not a fan and not a heap — the cards are laid out to be read and compared, so on hover a cell GROWS to a readable size instead of lifting. Its life is two props: open (the choice is on: every cell alive) and chosen (the named one holds enlarged while the rest slide away); selected is what the choice is armed on but not yet committed. Entrance — a per-cell stagger. Confirmation lives outside, usually ConfirmAction: naming a card is irreversible. WHERE the catalog stands is the scene’s business; the block fills the area it is given.',
    },
    where: {
      ru: 'table/CardCatalog → PickSpecific, OpponentTakes',
      en: 'table/CardCatalog → PickSpecific, OpponentTakes',
    },
    status: 'ok',
  },
  {
    mod: 'useCardPreview',
    what: {
      ru: 'Чтение карты, которая стоит НА СТОЛЕ — той, что вышла в центр: 503 из колоды, эффект AI, чужая атака. Превью показывается в ОДНОМ постоянном месте справа, а не у курсора: место, которое игрок запоминает, и которое заведомо не накрывает центр, где всё и происходит. Размер — зум руки в максимуме плюс 15% и минус 10%. Привязка к СЛОТУ, а не к «карте в центре»: у Defense Release таких слотов пять, и каждый читается сам по себе. Закрывается ОДНИМ правилом — курсор сдвинулся туда, где нет ни читаемого слота, ни самого превью. Из этого правила сами собой выпадают два нужных поведения: карта улетела в сброс, пока её читают (слот размонтировался под неподвижным курсором, mouseleave не приходит — превью висит до движения мыши, НАМЕРЕННО наоборот к зуму руки, который обязан уйти вместе с картой), и курсор на самом превью (висит, иначе превью над сбросом мигало бы). Рубашкой вверх не показывается: у чужой закрытой карты нет личности и в проекции. Задержка есть только на УХОД со слота (90ms): слоты стоят в нескольких пикселях друг от друга, и без неё превью мигало бы при переходе на соседнюю карту. Глухого периода нет намеренно — иначе наведение на другую карту в центре переставало бы отвечать.',
      en: 'Reading a card that stands ON THE TABLE — the one at the centre: a 503 out of the deck, an AI effect, somebody else’s attack. The preview shows at ONE fixed place on the right, never at the cursor: a place the player learns, and one that cannot cover the centre where the game happens. Size — the hand’s hover zoom at its largest, plus 15% and minus 10%. Bound to a SLOT rather than to "the card at the centre": Defense Release has five of them and each reads on its own. ONE rule closes it — the pointer moved somewhere that is neither a readable slot nor the preview. Two needed behaviours fall out of that rule by themselves: the card flies to the discard while being read (its slot unmounts under a still cursor, no mouseleave is fired — the preview stays until the hand moves, DELIBERATELY the opposite of the hand’s zoom, which must leave with its card), and the pointer resting on the preview (it stays, or a preview over the discard would flicker). Face-down shows nothing: somebody else’s closed card has no identity in the projection either. The only delay is on LEAVING a slot (90ms): slots stand a few px apart and without it the preview would blink when crossing to the neighbouring card. There is deliberately no blind period — one would stop the centre answering when you move onto another card there.',
    },
    where: {
      ru: 'table/CardPreview → CardPlay, AiCards, Error503, DefenseRelease, Board',
      en: 'table/CardPreview → CardPlay, AiCards, Error503, DefenseRelease, Board',
    },
    status: 'ok',
  },
  {
    mod: 'useCardTilt() + CardMotionProvider',
    what: {
      ru: 'Наклон лица карты — вся математика в одном месте: курсор → отклонение p (по нему ComposedFace разводит слои), ховер и готовый transform. Обе формы карты берут её отсюда. Параметр from — отклонение, с которым лицо РОЖДАЕТСЯ и из которого выпрямляется: карту, оторванную из веера на слой перетаскивания, рисует НОВЫЙ экземпляр, а новый рождается плоским, и выпрямление, через которое слой проходит по каждому уходу курсора, просто не случается. CardMotionProvider — экранный выключатель параллакса: не проп, а контекст, потому что это решение про весь экран, а не про карту, и проброс флага положил бы настройку отображения в API руки, мест, стопок и зоны релиза. Гасит ТОЛЬКО слежение за курсором: подъём по ховеру остаётся, он отвечает «курсор на этой карте», а это обратная связь, а не украшение.',
      en: 'The tilt of a card face — the whole math in one place: pointer → deflection p (which ComposedFace shifts each layer by), hover, and the ready transform. Both card shapes take it from here. The `from` parameter is the deflection a face is BORN with and straightens out of: a card torn out of the fan onto the drag layer is drawn by a NEW instance, and a new instance is born flat, so the straightening the layer transitions through on every mouseleave simply never happens. CardMotionProvider is the screen-wide parallax switch: a context and not a prop, because it is a decision about a whole screen rather than about one card, and threading a flag would put a display preference into the APIs of the hand, the seats, the piles and the release zone. It mutes ONLY the pointer tracking: the hover lift stays, since it answers "the cursor is on this card", which is feedback and not decoration.',
    },
    where: {
      ru: 'cards/useCardTilt + cards/cardMotion → Card, CardParallax; выключатель — в настройках экрана Table',
      en: 'cards/useCardTilt + cards/cardMotion → Card, CardParallax; the switch lives in the Table screen settings',
    },
    status: 'ok',
  },
  {
    mod: 'ConfirmAction',
    what: {
      ru: 'Общий слайд-бар подтверждения выбора: заезжает по open, прижат к низу контейнера, опциональная подпись. Презентационный, i18n-agnostic.',
      en: 'The shared confirm-the-selection bar: slides up on open, pinned to the bottom of its container, an optional caption. Presentational, i18n-agnostic.',
    },
    where: {
      ru: 'table/ConfirmAction → CherryPick, Rebase, SystemUpgrade, AiCards (Inside), PickSpecific, OpponentTakes',
      en: 'table/ConfirmAction → CherryPick, Rebase, SystemUpgrade, AiCards (Inside), PickSpecific, OpponentTakes',
    },
    status: 'ok',
  },
  {
    mod: "play('hudIn')",
    what: {
      ru: 'Блок интерфейса приходит на своё место: короткий сдвиг по заданной оси + проявление. dx/dy — ОТКУДА он приходит (0/0 — чистое проявление, как у фоновой сетки), delay держит его невидимым до своей очереди (fill: both). Сдвиг живёт на transform, поэтому вешать пресет надо на ВНУТРЕННИЙ узел блока: на самом блоке transform обычно держит позиционирование (translate(-50%)). Из него собирается вся очередь появления экрана.',
      en: 'A HUD block arrives at its place: a short shift along the given axis + a fade in. dx/dy — WHERE it comes from (0/0 is a plain fade, as the background grid does), delay holds it invisible until its turn (fill: both). The shift lives on transform, so the preset goes on the block’s INNER node: on the block itself transform usually holds the positioning (translate(-50%)). The whole entrance order of a screen is built from it.',
    },
    where: { ru: 'словарь → Game Deal', en: 'registry → Game Deal' },
    status: 'ok',
  },
  {
    mod: "play('confettiFly')",
    what: {
      ru: 'Одна частица хлопушки: выстрел в заданном направлении, дуга через верх (peak) и падение с вращением, в конце — растворение. Пресет знает только полёт ОДНОЙ частицы; разброс, количество и символы — на сцене.',
      en: 'One piece of a party popper: a throw in a given direction, an arc over the top (peak) and a fall with spin, dissolving at the end. The preset knows one PIECE’s flight only; the spread, the count and the symbols belong to the scene.',
    },
    where: { ru: 'словарь → Game End', en: 'registry → Game End' },
    status: 'ok',
  },
]

// ===== 2. Scenario combinations — sequences per situation (no statuses) =====
// The middle column is technical: modules + key implementation points
// (rect measurements, FLIP, DOM order, key-remount, fixes), not a summary.
const SCENARIOS: Scenario[] = [
  {
    name: { ru: 'Розыгрыш карты', en: 'Playing a card' },
    from: {
      ru: 'flyer (fixed) от rect карты → playToCenter (move 480, EASE) по центрам; wait — удержание; nextFrames перед стартом, чтобы новый узел успел отрисоваться; затем centerToDiscard (move 420) + jitter() на финальные rotate/dx/dy разброса.',
      en: 'flyer (fixed) from the card rect → playToCenter (move 480, EASE) by centers; wait — hold; nextFrames before start so the new node can paint; then centerToDiscard (move 420) + jitter() for the final scatter rotate/dx/dy.',
    },
    where: 'CardPlay, DeckAnimations',
  },
  {
    name: { ru: 'Переход состояния TurnDock', en: 'TurnDock state transition' },
    from: {
      ru: 'один фиксированный каркас, слоты не двигаются. Ключ/имя — ОДНА фикс-ширина (≈ «добор» + 18px с каждой стороны), не ресайзится и не прыгает. Текст (фаза, метка ключа, ник) — чистый фейд rollOut→rollIn через Swap, без движения. Держит рамку кнопки, меняется только метка + акцент (CSS-transition на --btn-accent). Имя соперника (первый вход и смена ника подряд) появляется одинаково: ждёт ухода предыдущего (delayIn), потом проявляется. «drawn»-бейдж — popIn/popOut (Reveal). Кольцо и точка стоят на месте: только морф акцента (transition на stroke/--dot) + дозаполнение кольца до полного (progress→1 при смене фазы). ДОБАВЛЕНО: две фазы, которых не хватало столу. attack — идёт чужое окно, и по нему можно ударить: ключ ЗАГОРАЕТСЯ (тот же выступ дока, только ярче — не плоская заливка), рядом точки по числу мест, которые ещё могут ударить, гаснущие с каждым пасом. exposed — окно висит над ТВОИМ релизом: цвет хода остаётся твоим, часы — окна, а в слоте ключа стоят те же точки, потому что нажимать нечего. Плюс правило про часы: смотрящий НЕ видит чужого отсчёта — это не его время, и число, на которое он не влияет, только дёргается перед ним; в ветке ожидания чужого решения кольцо полное и без цифры. Таймеры целиком выключаются настройкой хоста в настройках стола.',
      en: 'one fixed frame, slots never move. Key/name — ONE fixed width (≈ the «добор» key + 18px each side), never resizes or jumps. Text (phase, key label, nick) — a plain opacity fade rollOut→rollIn via Swap, no movement. The button frame stays, only the label + accent change (CSS transition on --btn-accent). The opponent name (first entry and successive nick changes alike) appears the same way: it waits for the previous to clear (delayIn), then fades in. The “drawn” badge — popIn/popOut (Reveal). Ring and dot stay put: only the accent morphs (transition on stroke/--dot) + the ring fills back to full (progress→1 on a phase change). ADDED: the two phases the table was missing. attack — somebody else has a window open and you may hit it: the key LIGHTS UP (the same dock ledge, only stepped up — not a flat fill), with dots beside it, one per seat that may still hit, going out with each pass. exposed — the window hangs over YOUR release: the turn colour stays yours, the clock is the window, and the key slot holds those same dots because there is nothing to press. Plus the clock rule: a watcher does NOT see somebody else time — it is not theirs to spend, and a number they cannot act on only twitches while they wait; in the waiting branch the ring is full and carries no figure. Timers switch off entirely from the host settings on the table.',
    },
    where: 'TurnDock (Swap, Reveal), RingTimer, StatusDot, Button hud',
    board: 'pages/board/[gameId]/_Board.tsx',
  },
  {
    name: { ru: 'Розыгрыш комбо (пара)', en: 'Playing a combo (pair)' },
    from: {
      ru: 'useArrow + centerOf ведёт прицел; совмещение — foldIntoPair по разу на половину (первый кадр красится enterPose, иначе половины мигнут в конечной позе; вспомогательная приземляется в PAIR_AUX_POSE самого CardPair, поэтому передача пары в статичный слот не видна). Здесь у неё вырожденный случай: вторая карта УЖЕ стоит в центре, и это выражено как enterPose(box, box) — та же формула даёт identity, отдельной ветки нет. Релиз → playToReleaseZone (move 480, SNAP-приземление); в сброс — через useDiscardExit (пара распадается на 2 одиночки, каждая от своего якоря); отмена — через useHandArrival (сборка возвращается в середину веера разом). То же теперь играется и на живом борде (#100): партнёра называет `state.comboOptions` проекции (`PlayerView.self.combos`, `packages/engine/src/fake/project.ts`), вытягивание опоры из веера и клик по партнёру — `_useBoardStaging.ts` (`onHandPlay`/`onCardClick`, фолд портирован из `pickPartner` дословно), а что происходит после ответа движка — отдельный такт `features/board-beats/comboBeat.tsx`: `attackPlaced`/`releasePlaced` заводят пару с чужой стороны либо отдают стол назад, если она уже стоит там, где нужно (передача `StagedHandoff`), `pairToDiscard` расщепляет ожидающую пару в сброс по резолюции. Два открытых пункта — реестр ниже и docs/animations/backlog.md. ОБНОВЛЕНО: сам жест складывания теперь шаг usePairFold() — он поднимает пару, красит обеим половинам входные позы и складывает их разом; сцена отдаёт ему две карты и рамку, а к узлу обращается через node() на ногах после складывания (релиз в слот зоны, распад в сброс, возврат в веер). Вырожденный случай не потребовал ветки: опора уже стоит в центре, значит её «откуда» совпадает с рамкой и вход выходит тождественным.',
      en: "useArrow + centerOf drives the aim; the pairing — foldIntoPair once per half (the first frame painted with enterPose, else the halves flash in their final pose; the aux lands on CardPair’s own PAIR_AUX_POSE, so handing the pair to a static slot is invisible). Here it has the degenerate case: the second card is ALREADY at the centre, expressed as enterPose(box, box) — the same formula yields identity, no separate branch. Release → playToReleaseZone (move 480, SNAP landing); to the discard — via useDiscardExit (the pair splits into 2 singles, each from its own anchor); cancel — via useHandArrival (the staging returns to the middle of the fan at once). The same movement now also runs on the live board (#100): the projection's own `state.comboOptions` (`PlayerView.self.combos`, `packages/engine/src/fake/project.ts`) names the partner, pulling the support out of the fan and clicking one is `_useBoardStaging.ts` (`onHandPlay`/`onCardClick`, the fold ported from `pickPartner` verbatim), and what happens once the engine answers is a separate beat, `features/board-beats/comboBeat.tsx`: `attackPlaced`/`releasePlaced` fold the pair in from elsewhere or hand the table back if it is already standing where it needs to be (the `StagedHandoff` seam), `pairToDiscard` splits the pending pair into the discard at resolution. Two open findings — register below and docs/animations/backlog.md. UPDATED: the fold itself is now the usePairFold() step — it raises the pair, paints both halves at their entry poses and folds them at once; the scene hands it two cards and a frame and reaches the node through node() for the legs after the fold (the release into its zone slot, the split into the discard, the return to the fan). The degenerate case needed no branch: the source already stands at the centre, so its origin coincides with the frame and the entry pose comes out as identity.",
    },
    where: 'Combo',
    board: 'features/board-beats/comboBeat.tsx',
  },
  {
    name: { ru: 'Адресная атака стрелкой', en: 'Targeted arrow attack' },
    from: {
      ru: 'useArrow строит from/to по centerOf карты и цели, слежение за курсором (mousemove), старт/стоп по фазе розыгрыша. То же теперь играется и на живом борде (#99): цели — `self.targets` проекции, та же `attackTargets`, которую проверяет редьюсер (`packages/engine/src/fake/project.ts`), в `TableTarget` переходят структурным приведением типа, не пересчётом (`toBoardState.ts`). Жест — `_useBoardStaging`: вытягивание из веера карты с целями ставит её в центр (playToCenter, продолжение от HandPlayDrop.rect), стрелка встаёт от центра и целится, нажатие на освещённую цель диспатчит PLAY. Промах или Escape возвращают карту в свой слот веера (useHandArrival), цели гаснут синхронно; `rejected` после диспатча — тем же путём. Клик по карте с целями больше не работает: клик остался только для атаки из окна и розыгрыша без цели (`_useBoardInteractions`). Что стоит в центре после диспатча — статичный рендер (`data-pending-play`), шов, на который встанет такт #100. Жест на сенсорном экране не решён (реестр ниже, docs/animations/backlog.md).',
      en: "useArrow builds from/to from centerOf the card and the target, cursor tracking (mousemove), start/stop by the play phase. The same movement now also runs on the live board (#99): targets come off the projection's `self.targets` — the same `attackTargets` the reducer itself validates (`packages/engine/src/fake/project.ts`) — and reach `TableTarget` by a structural type cast, not a recompute (`toBoardState.ts`). The gesture is `_useBoardStaging`: pulling a card with targets out of the fan stages it at the centre (playToCenter, continuing from HandPlayDrop.rect), the arrow arms from the centre and aims, a press on a lit target dispatches PLAY. A miss or Escape returns the card to its own fan slot (useHandArrival), targets going dark synchronously; a `rejected` after dispatch takes the same path back. Clicking a card with targets no longer works — the click keeps only the window attack and the no-target play (`_useBoardInteractions`). What stands at the centre after dispatch renders statically (`data-pending-play`) — the seam #100's beat builds on. The gesture on a touchscreen is undecided (register below, docs/animations/backlog.md).",
    },
    where: 'Arrow, Combo',
    board: 'pages/board/[gameId]/_useBoardStaging.ts',
  },
  {
    name: { ru: 'Разделение колоды', en: 'Splitting the deck' },
    from: {
      ru: 'FLIP-вылет flyFrom: половина уже в новом DOM-месте, анимируем «из» прошлого rect (getBoundingClientRect до→после ремаунта) в текущую позицию. То же движение теперь играется на живом борде из pilesChanged (deckBeat, «The deck is rebuilt, split, merged (live board)» в recipes.md) — какая стопка разделилась, там не называется событием, а выводится позиционно (classifyPiles, docs/animations/backlog.md).',
      en: 'FLIP fly-in flyFrom: half is already in its new DOM place, we animate "from" the previous rect (getBoundingClientRect before→after remount) to the current position. The same movement now also runs on the live board off pilesChanged (deckBeat, "The deck is rebuilt, split, merged (live board)" in recipes.md) — which pile split is not named by the event, it is derived positionally (classifyPiles, docs/animations/backlog.md).',
    },
    where: 'DeckAnimations',
    board: 'features/board-beats/deckBeat.tsx',
  },
  {
    name: { ru: 'Слияние колод (+ сброс)', en: 'Merging decks (+ discard)' },
    from: {
      ru: 'все стопки и сброс — параллельные absorbToDeck (move + fade) в один rect первой колоды; цель измеряется однажды, расходятся только источники. То же движение играется на живом борде из pilesChanged (deckBeat) — теперь на РЯД стопок (decks.main: number[]), а не на одну.',
      en: 'all piles and the discard — parallel absorbToDeck (move + fade) into the single rect of the first deck; the target is measured once, only the sources differ. The same movement now also runs on the live board off pilesChanged (deckBeat) — over a ROW of piles (decks.main: number[]) rather than one.',
    },
    where: 'DeckAnimations',
    board: 'features/board-beats/deckBeat.tsx',
  },
  {
    name: { ru: 'Сброс → новая колода', en: 'Discard → new deck' },
    from: {
      ru: 'собрать разбросанный сброс в стопку → gatherToDeck (move, центр-в-центр) к месту колоды → flipCard рубашкой вверх по приземлении. То же движение играется на живом борде дважды: как deckReshuffled (обычный ребилд на пилу 0) и как второй шаг Git Branch + Sudo внутри pilesChanged (fromDiscard, на индекс, который назвал сплит) — обе ветки через один и тот же discardOntoPile в deckBeat.',
      en: "gather the scattered discard into a pile → gatherToDeck (move, center-to-center) to the deck spot → flipCard back-up on landing. The same movement now also runs on the live board twice: as deckReshuffled (an ordinary rebuild onto pile 0) and as Git Branch + Sudo's second step inside pilesChanged (fromDiscard, onto the index the split just named) — both branches through the same discardOntoPile in deckBeat.",
    },
    where: 'DeckAnimations',
    board: 'features/board-beats/deckBeat.tsx',
  },
  {
    name: { ru: 'Добор карты (одиночный)', en: 'Drawing a card (single)' },
    from: {
      ru: 'drawToCenter (move 480) колода→центр рубашкой вверх; ветвление по карте: игрок — flipCard + useHandArrival.insert (садится в слот руки); соперник — dealToSeat (move + fade) в card-area места ×0.7, без скейла вверх; триггер/AI — flipCard в центре (reveal для всех), AI ещё добирает эффект из AI-колоды рядом (flyer с key={seq}, чтобы Card не переиспользовалась и не крутилась). Три ветки — свой / чужой / триггер — теперь играются и на живом борде от настоящих drawn/revealed событий (drawBeat, «A card is drawn (live board)» в recipes.md); AI-ветка там не участвует (#106).',
      en: 'drawToCenter (move 480) deck→center back-up; branch by card: player — flipCard + useHandArrival.insert (sits into a hand slot); opponent — dealToSeat (move + fade) into the seat card-area ×0.7, no upward scale; trigger/AI — flipCard at the center (reveal for all), AI also draws an effect from the nearby AI deck (flyer with key={seq} so the Card is not reused and does not spin). The mine/opponent/trigger branches now also run on the live board off real drawn/revealed events (drawBeat, "A card is drawn (live board)" in recipes.md); the AI branch is not part of that (#106).',
    },
    where: 'DrawCard',
    board: 'features/board-beats/drawBeat.tsx',
  },
  {
    name: { ru: 'Мультидобор (по кнопке)', en: 'Multi-draw (by button)' },
    from: {
      ru: 'батч из N карт (N = число колод) гонит тот же одиночный сценарий через drawOne → boolean; на неразрешённом триггере (Error 503) drawOne возвращает false и серия рвётся — ждёт ручного разбора карты (фикс-сценариев под триггеры нет).',
      en: 'a batch of N cards (N = deck count) runs the same single scenario via drawOne → boolean; on an unresolved trigger (Error 503) drawOne returns false and the series breaks — it waits for manual card resolution (there are no fixed scenarios for triggers).',
    },
    where: 'DrawCard',
  },
  {
    name: { ru: 'Разрешение AI (уход карт)', en: 'AI resolution (cards leaving)' },
    from: {
      ru: 'resolveAi(trig, eff) — карты приходят аргументами, не из стейта (фикс stale-closure на клике); wait (имитация логики) → параллельно: триггер centerToDiscard + jitter() в сброс; эффект flipCard рубашкой на месте со стаггером → returnToDeck (move) в AI-колоду с уменьшением до её размера.',
      en: 'resolveAi(trig, eff) — cards arrive as arguments, not from state (a stale-closure fix on click); wait (logic simulation) → in parallel: the trigger centerToDiscard + jitter() to the discard; the effect flipCard back-up in place with a stagger → returnToDeck (move) into the AI deck, shrinking to its size.',
    },
    where: 'DrawCard',
  },
  {
    name: { ru: 'Тревога Error 503 (краевое свечение)', en: 'Error 503 alarm (edge glow)' },
    from: {
      ru: 'EdgeGlow внутри контейнера зоны стола (.glowBounds — inset:0 области демонстрации: край экрана ≠ край стола, и мерить нечего, потому что зона стола и есть сцена); своя вытяжка — strong ДО Hand в DOM (ПОД рукой); соперник — weak ПОСЛЕ Hand (НАД рукой) + pointer-events:none, чтобы не глушить ховер-реакцию руки; появление/затухание — CSS-transition opacity.',
      en: 'EdgeGlow inside the table-zone container (.glowBounds — inset: 0 of the demo area: screen edge ≠ table edge, and there is nothing to measure because the table zone IS the stage); own layer — strong BEFORE Hand in the DOM (UNDER the hand); opponent — weak AFTER Hand (OVER the hand) + pointer-events:none so it does not smother the hand hover reaction; fade in/out — CSS-transition opacity.',
    },
    where: 'DrawCard',
  },
  {
    name: { ru: 'Взятие случайной карты соперника', en: "Taking an opponent's card at random" },
    from: {
      ru: 'веер соперника — тот же Hand, рубашкой, развёрнутый на 180° — съезжает сверху и стоит протянутым (CSS-transition на .topHand по data-in). Клик по рубашке отправляет остальной веер обратно за верх, а выбранная карта едет к центру ЭКРАНА (у этой сцены нет поправки на сайдбар, в отличие от двух соседних), разворачиваясь по пути из rotate(180deg) в ноль; там flipCard лицом, REVEAL_HOLD, дальше useHandArrival (зазор в руке + посадка по slotPlacement). Слот-донор рендерит null, пока карту несёт flyer. Выбора «какая карта» тут нет: игрок жмёт рубашку и узнаёт результат уже в центре — это REVEAL, и ровно эту половину борд оставляет, когда карту выбирает сид движка. На борде (#105) веера соперника нет, есть место: backs выезжают из места донора (takeFromSeat, стаггер OFFER_STEP, дуга offerPoses, cap OFFER_MAX = 9), держатся OFFER_HOLD и уезжают обратно, а взятая карта летит отдельно из того же места. Жест перенесён, геометрия — нет.',
      en: "the opponent fan — the same Hand, backs up, turned 180° — slides down from the top and stands held out (a CSS transition on .topHand driven by data-in). Clicking a back sends the rest of the fan back up off the top while the chosen card travels to the VIEWPORT centre (this scene has no sidebar inset to correct for, unlike its two siblings), turning from rotate(180deg) to zero on the way; there it flips face up, REVEAL_HOLD, then useHandArrival (a gap in the hand + landing per slotPlacement). The donor slot renders null while the flyer carries the card. Nothing here chooses WHICH card: the player clicks a back and learns the answer at the centre — it is a REVEAL, and that is exactly the half the board keeps when the engine's seed does the choosing. On the board (#105) there is no opponent fan, only a seat: the backs rise out of the donor's seat (takeFromSeat, staggered by OFFER_STEP, along the offerPoses arc, capped at OFFER_MAX = 9), hold for OFFER_HOLD and go back, while the taken card flies on its own out of the same seat. The gesture was carried over; the geometry was not.",
    },
    where: 'PickOpponentCard',
    board: 'features/board-beats/transferBeat.tsx, features/board-beats/planBeats.ts',
  },
  {
    name: { ru: 'Каноничная рука (взять-потянуть)', en: 'Canonical hand (pick up & drag)' },
    from: {
      ru: 'взять карту мышкой и потянуть: наружу из руки → розыгрыш (onPlay), внутри руки → перестановка (onReorder, локальная). Порог DRAG_THRESHOLD различает клик и drag — клик (onCardClick) сосуществует. Летящая карта — fixed flyer за курсором (rAF); при отпускании settleInto доводит её в слот (rotate до угла, z под соседей). transform-origin: bottom center у флайера совпадает с пивотом слота — без финального прыжка. Ховер: подъём + расступание соседей (без in-place scale и без выхода на верхний слой), читаемость — отдельный зум-превью над рукой (появление разово через @keyframes zoom-rise, уход только opacity).',
      en: 'pick a card with the mouse and drag: out of the hand → play (onPlay), inside the hand → reorder (onReorder, local). A DRAG_THRESHOLD tells a click from a drag — a click (onCardClick) coexists. The flyer is a fixed node following the cursor (rAF); on release settleInto glides it into the slot (rotate to the slot angle, z tucked under the neighbours). The flyer’s transform-origin: bottom center matches the slot pivot — no end-of-glide jump. Hover: lift + neighbours part (no in-place scale, no jump to the top layer); readability comes from a separate zoom preview above the hand (one-shot appear via @keyframes zoom-rise, exit is opacity only).',
    },
    where: 'Hand (fan), HandStory',
    board: 'pages/board/[gameId]/_useBoardStaging.ts, features/hand-order/useHandOrder.ts',
  },
  {
    name: { ru: 'Error 503 — ход игрока и защита', en: 'Error 503 — player turn & defence' },
    from: {
      ru: 'добор из колоды → 503 в центр + красное краевое свечение. У ЛЮБОГО ответа одна форма: карта летит в центр, накрывает тревогу со смещением (обе читаются), обе стоят открытыми COVER_HOLD и уходят в сброс одним обменом (useDiscardExit: тревога снизу, ответ сверху, пара с Code Review разбирается шагом). Monitoring — тот же такт без карты. Бросок принимает ВЕСЬ стол; отдаёт назад только своя область (зона + рука). Без защиты: рука сметается к центру, держится GATHER_HOLD (такт из Hand limit) и разлетается в сброс, дальше полноэкранное видео вылета (случайное из папки сцены). То же теперь играется и на живом борде (#102): пулл Debugger/Release из веера или клик по Monitoring — жест и накрывающий обмен в `_useNeutralizeStaging.tsx`, разрешение по методу — `runNeutralized` в `defenseBeat.tsx`; без защиты — тот же обмен, но сначала сгребание всего стола в кучу к центру (`discardBeat.tsx`, нога `gather`), и лишь потом разлёт; своё сильное свечение ПОД рукой и слабое чужое НАД ней — оба монтируются в `_Board.tsx`. Видео вылета — свой такт следом (#103): `eliminateBeat.tsx` кладёт клип на всю сцену (inset: 0 стола, не окна) поверх уже осевшего стола, держит стол за собой (exclusive), крутит петлю до ELIM_MIN_MS и уходит. Клип не случайный: индекс считается из id события вылета, поэтому у всех за столом идёт ОДИН клип, и на провод для этого ничего не уходит. При prefers-reduced-motion такта нет вообще — доска просто стоит в состоянии вылета. Время воспроизведения выведено, а не назначено: петля крутится до ELIM_MIN_MS, последний проход доигрывается целиком, и это идеальное время ВЫБРАННОГО клипа (первый целый проход на пороге или за ним — 6.10 / 6.53 / 6.47 / 9.40s у нынешних четырёх), а сторож ставится на него ПЛЮС запас на шов, по запасу на проход: реальное воспроизведение всегда чуть длиннее идеального (ended, перемотка, play(), кадр), и сторож ровно по идеальному числу обгонял бы последний ended на каждом зацикленном клипе. Отсчёт начинается с реального воспроизведения (`playing`), а не с монтирования, иначе загрузка тратит бюджет самого клипа. Длительности лежат рядом со списком, и тест сверяет их с `moov/mvhd` самих файлов — подмена клипа роняет тест, а не сбивает такт молча. Отказ кодека или битый файл — `error`, стол отдаётся сразу; отказ автоплея — реджект `play()`, туда же. Клипы забираются заранее, в браузерном idle, когда партия уже идёт, так что к моменту вылета они в кэше.',
      en: "draw from the deck → 503 to the centre + red edge glow. EVERY answer has the same shape: the card flies to the centre, covers the alarm nudged aside (both readable), both stand open for COVER_HOLD and leave as one exchange (useDiscardExit: the alarm underneath, the answer on top, a pair with its Code Review split by the step). Monitoring is the same beat without a card. The WHOLE table accepts the drop; only the player's own area (zone + hand) gives the card back. No defence: the hand sweeps to the centre, holds for GATHER_HOLD (the hand-limit beat) and scatters to the discard, then a full-screen elimination video (random from the scene folder). The same movement now also runs on the live board (#102): pulling a Debugger/Release out of the fan or clicking Monitoring is the gesture and the covering exchange in `_useNeutralizeStaging.tsx`, resolved by method through `runNeutralized` in `defenseBeat.tsx`; with no defence, the same exchange happens, but the whole table is gathered into a heap at the centre first (`discardBeat.tsx`'s `gather` leg), and only then scatters. The own strong glow UNDER the hand and the opponent's weak glow OVER it both mount in `_Board.tsx`. The elimination video is its own beat behind it (#103): `eliminateBeat.tsx` lays the clip over the whole stage (inset: 0 of the table, not the viewport) on top of a board that has already settled, holds the table while it plays (exclusive), loops until ELIM_MIN_MS and goes. The clip is not random — the index is derived from the elimination event id, so the whole table watches ONE clip, and nothing about it goes on the wire. Under prefers-reduced-motion there is no beat at all: the board simply stands in its eliminated state. The playback time is derived rather than assigned: the loop runs to ELIM_MIN_MS, the pass it is in plays out, and that is the CHOSEN clip's ideal end (the first whole loop at or past the floor — 6.10 / 6.53 / 6.47 / 9.40s for the current four), and the guard is armed with that PLUS seam room, one allowance per pass: real playback always runs a little longer than the ideal (ended, the rewind, play(), a frame), and a guard on the ideal number exactly would beat the last ended to the exit on every clip that loops. The count starts at real playback (`playing`), not at mount, or loading would spend the clip's own budget. The lengths live beside the list and a test reads them back out of the files' own `moov/mvhd` — swapping a clip fails the test instead of silently mis-timing the beat. A refused codec or a broken file is `error` and the table comes straight back; a refused autoplay rejects `play()` and goes the same way. The clips are fetched ahead of time, at browser idle once the match is running, so they are in cache by the time anybody is eliminated.",
    },
    where: 'Error503Story',
    board:
      'pages/board/[gameId]/_useNeutralizeStaging.tsx, features/board-beats/defenseBeat.tsx, features/board-beats/discardBeat.tsx, features/board-beats/eliminateBeat.tsx, pages/board/[gameId]/_Board.tsx',
  },
  {
    name: { ru: 'AI-эффекты — разрешение', en: 'AI effects — resolution' },
    from: {
      ru: 'добор AI-триггера из базовой колоды → выбранная AI-карта из колоды событий в центр (drawToCenter, крупнее) → hold на столе → разрешение по эффекту. Карта события ВСЕГДА возвращается в AI-колоду (returnToDeck); в общий сброс идут только триггер (centerToDiscard) и уничтоженный ОБЫЧНЫЙ релиз. Release/Monitoring → в пустой слот (playToReleaseZone) и остаётся. Crush → уничтожает совпавший релиз (AI-релиз → AI-колода, обычный → сброс). Inside → релиз из сброса через центр в руку (useHandArrival); при нескольких — открытый ряд-выбор с ConfirmAction, невыбранные летят обратно в сброс. Good Vibe → добор 2 карт; триггер в доборе отыгрывается полностью первым, Hallucination ставит флаг прерывания — 2-й добор пропускается. Bad Vibe → карта вытаскивается ИЗ ВЕЕРА и тем же движением встаёт справа от AI-карты, стоит открыто PICK_HOLD, и дальше всё уходит одновременно: триггер в сброс, AI-карта в колоду событий, отданная карта в сброс. Ховер руки заглушён во время анимаций (pointer-events).',
      en: 'draw the AI trigger from the base deck → the chosen AI card from the events deck to the center (drawToCenter, larger) → hold → resolve by effect. An event card ALWAYS returns to the AI deck (returnToDeck); only the trigger (centerToDiscard) and a destroyed ORDINARY release reach the common discard. Release/Monitoring → into an empty slot (playToReleaseZone) and stays. Crush → destroys the matching release (AI release → AI deck, ordinary → discard). Inside → a release from the discard through the center into the hand (useHandArrival); with several, an open row choice + ConfirmAction, the rest fly back to the discard. Good Vibe → draws 2 cards; a drawn trigger resolves fully first, Hallucination raises a turn-interrupt flag — the 2nd draw is skipped. Bad Vibe → the card is pulled OUT of the fan and, in the same movement, takes its place to the right of the AI card; it stands open for PICK_HOLD, and then everything leaves at once: the trigger to the discard, the AI card back to its deck, the given-up card to the discard. Hand hover is muted during animations (pointer-events).',
    },
    where: 'AiCardsStory',
    board:
      'features/board-beats/aiBeat.tsx, features/board-beats/planBeats.ts, pages/board/[gameId]/_Board.tsx',
  },
  {
    name: { ru: 'Забрать конкретную карту', en: 'Take a specific card' },
    from: {
      ru: "CardCatalog (без триггеров) в средней полосе + веер соперника рубашкой сверху (data-in слайд). Выбор заряжается кликом и подтверждается ConfirmAction, дальше держит PICK_BEAT: названная карта стоит увеличенной, остальные уезжают. Хит — карта вылетает из слота соперника к центру стола (CSS-transition, центр от rootRef, не window), flip лицом, REVEAL_HOLD, затем useHandArrival в руку. Мисс — веер вздрагивает на месте: play('shake') характером spring, amp 9 / 460ms (крупный элемент вздрагивает всем собой), подпись, веер уезжает. Слот-донор рендерит null, пока карту несёт flyer. На борде (#105) это два такта в разных батчах: runRequested поднимает названную карту в центре у ВСЕХ (popIn — лететь неоткуда, ячейка каталога живёт в чужом хуке), а на попадании передаёт её проекции — _Board.tsx рисует cardById(pending.requested), пока движок ждёт передачи, — и уже следующим батчем приходит нога taker в runTransfer: takeFromSeat из места донора, flip лицом, REVEAL_HOLD, useHandArrival. Промах несёт весь такт целиком: REQUEST_HOLD, shake по цели (её МЕСТО — всем смотрящим, её собственный веер — ей самой), подпись, MISS_HOLD.",
      en: "CardCatalog (no triggers) in the middle band + the opponent fan back-up from the top (data-in slide). The pick is armed by a click and committed through ConfirmAction, then holds PICK_BEAT: the named card stands enlarged while the rest slide away. Hit — the card flies out of the opponent slot to the stage centre (CSS transition, centre from rootRef not window), flips face up, REVEAL_HOLD, then useHandArrival into the hand. Miss — the fan flinches in place: play('shake') in its spring character, amp 9 / 460ms (a large element flinches whole), a note, and the fan leaves. The donor slot renders null while the flyer carries the card. On the board (#105) this is two beats in two batches: runRequested raises the named card at the centre for EVERYONE (popIn — there is nowhere to fly from, the catalog cell lives in another hook), and on a hit hands it to the projection — _Board.tsx renders cardById(pending.requested) while the engine waits for the hand-over — and only the next batch brings runTransfer's taker leg: takeFromSeat out of the donor's seat, flip face up, REVEAL_HOLD, useHandArrival. A miss is carried by the beat whole: REQUEST_HOLD, a shake on the target (their SEAT to everyone watching, their own fan to the target themselves), the note, MISS_HOLD.",
    },
    where: 'PickSpecificCardStory',
    board:
      'features/board-beats/transferBeat.tsx, features/board-beats/planBeats.ts, pages/board/[gameId]/_useRequestStaging.tsx, pages/board/[gameId]/_Board.tsx',
  },
  {
    name: { ru: 'У тебя забирают карту', en: 'Opponent takes your card' },
    from: {
      ru: 'зеркало «забрать конкретную» со стороны жертвы, и каталог выбора у них общий — тот же CardCatalog, только называет карту соперник (бродкаст): клик заряжает, ConfirmAction подтверждает, дальше PICK_BEAT держит названную увеличенной, пока остальные уезжают. Соперники в сцене — SEAT’ы, как на столе: рука у них скрыта, счётчик и ЕСТЬ рука, чужого веера здесь нет вовсе. Дальше two-hop CSS-transition from → center → up: в центре flip РУБАШКОЙ (теперь карта соперника), CENTER_HOLD, затем в место забравшего — не в его прямоугольник, а в cardBoxIn(seat, width * SEAT_SHRINK) (I6: место сильно шире карты), где карта сжимается и растворяется, а счётчик руки растёт. Это движение dealToSeat, то же самое, каким уходит добор к скрытой руке в Draw card. zIndex постоянный (55): подтыкаться не подо что, назначение — место, а не стопка карт. useHandArrival НЕ используется — карта уходит из руки, а не встаёт в неё. На борде (#105) это нога victim в runTransfer, один в один; отдачу выбранной копии там никто не спрашивает — копии различаются только uid, и _useRequestStaging резолвит giveCard сам.',
      en: "mirror of «take a specific card» from the victim, and the pick catalog is shared — the same CardCatalog, only the opponent names the card (a broadcast): a click arms it, ConfirmAction commits it, then PICK_BEAT holds the named card enlarged while the rest slide away. The opponents in this scene are SEATS, as on the table: their hands are hidden there, the counter IS the hand, and there is no opponent fan here at all. Then a two-hop CSS transition from → center → up: at the centre it flips FACE-DOWN (the opponent's card now), CENTER_HOLD, then into the taker's seat — not at the seat's own rect but at cardBoxIn(seat, width * SEAT_SHRINK) (I6: a seat is far wider than a card), where it shrinks and dissolves while their hand counter goes up. That is the dealToSeat movement, the same one a draw to a hidden hand takes in Draw card. zIndex is constant (55): there is nothing to tuck under, the destination is a seat and not a stack of cards. No useHandArrival — the card leaves the hand, it does not settle into one. On the board (#105) this is runTransfer's victim leg, one for one; nobody is asked which copy to surrender there — the copies differ only by uid, and _useRequestStaging resolves giveCard by itself.",
    },
    where: 'OpponentTakesCardStory',
    board:
      'features/board-beats/transferBeat.tsx, features/board-beats/planBeats.ts, pages/board/[gameId]/_useRequestStaging.tsx, pages/board/[gameId]/_Board.tsx',
  },
  {
    name: { ru: 'Git Cherry-pick (прототип)', en: 'Git Cherry-pick (prototype)' },
    from: {
      ru: 'сброс раздаётся в грид выбора (стаггер DEAL_STEP, cap STAGGER_CAP); выбранная — к центру, useHandArrival в руку; sudo-вторая — flipCard рубашкой + returnToDeck на колоду; невыбранные возвращаются в стопку по scatterAt (порядок сохраняется, без перетасовки). Rules-complete отложен (#61).',
      en: 'the discard deals into a selection grid (stagger DEAL_STEP, cap STAGGER_CAP); the pick → centre, useHandArrival into the hand; a sudo second card → flipCard back-up + returnToDeck onto the deck; the unpicked return to the pile by scatterAt (order kept, no reshuffle). Rules-complete deferred (#61).',
    },
    where: 'GitCards/CherryPick',
  },
  {
    name: { ru: 'Git Rebase (прототип)', en: 'Git Rebase (prototype)' },
    from: {
      ru: 'верхние 3 карты колоды вылетают в нумерованный ряд (DEAL_DUR/STEP), игрок меняет порядок, затем flipCard рубашкой + returnToDeck обратно на колоду в выбранном порядке (BACK_DUR/STEP). Знание о колоде не моделируется (#61 q9). Rules-complete отложен.',
      en: 'the top 3 cards fly out into a numbered row (DEAL_DUR/STEP), the player reorders, then flipCard back-up + returnToDeck onto the deck in the chosen order (BACK_DUR/STEP). Deck knowledge is not modelled (#61 q9). Rules-complete deferred.',
    },
    where: 'GitCards/Rebase',
  },
  {
    name: { ru: 'System Upgrade (прототип)', en: 'System Upgrade (prototype)' },
    from: {
      ru: 'каждый соперник бросает карту с места в центр (THROW_DUR/STEP, рост THROW_SCALE→1); base — после HOLD_MS всё в сброс (centerToDiscard, стаггер CLEAR_STEP); sudo — игрок берёт одну (reveal + useHandArrival), остальные в сброс. Rules-complete отложен.',
      en: 'each opponent throws a card from its seat to the centre (THROW_DUR/STEP, growing THROW_SCALE→1); base — after HOLD_MS all to the discard (centerToDiscard, stagger CLEAR_STEP); sudo — the player takes one (reveal + useHandArrival), the rest to the discard. Rules-complete deferred.',
    },
    where: 'GitCards/SystemUpgrade',
  },
  {
    name: { ru: 'Лимит карт в руке', en: 'Hand limit' },
    from: {
      ru: 'пока рука ВЫШЕ лимита, карту можно вытащить из веера — иначе Hand отклоняет и карта уезжает обратно. Сброшенные не идут в кучу по одной: они строят СЕТКУ в центре (форма выбрана заранее по известному числу лишних карт, каждая летит сразу в свою ячейку — playToCenter), сетка держится открытой, и только когда села последняя, вся она уходит в сброс через useDiscardExit со стаггером. Рука никогда не блокируется полётом: выбрасывание нелинейно — «подумал и быстро скинул». На живом борде (#104) жест в `_useHandLimit.tsx` владеет пуллами, параллельными полётами и сеткой до ответа движка; `handLimitBeat.tsx` принимает готовую сетку у локального игрока или строит ту же сетку с места соперника, держит общий с беззащитным Error 503 `GATHER_HOLD` и отправляет всё в сброс.',
      en: "while the hand is OVER the limit a card can be pulled out of the fan — otherwise Hand rejects the drop and it glides back. Discards do not reach the heap one at a time: they build a GRID at the centre (its shape chosen upfront from the known excess, every card flying straight to its own cell — playToCenter), the grid is held open, and only when the last one lands does the whole of it leave via useDiscardExit with a stagger. The hand is never blocked by a flight: discarding is non-linear — think, then dump fast. On the live board (#104), the gesture in `_useHandLimit.tsx` owns the pulls, concurrent flights and grid until the engine answers; `handLimitBeat.tsx` adopts the local player's finished grid or builds the same grid from an opponent seat, holds the `GATHER_HOLD` shared with a defenceless Error 503, and sends the whole grid to the discard.",
    },
    where: 'HandLimit',
    board: 'pages/board/[gameId]/_useHandLimit.tsx, features/board-beats/handLimitBeat.tsx',
  },
  {
    name: { ru: 'Защита релиза (полный ход)', en: 'Defending a release (a whole turn)' },
    from: {
      ru: 'релиз из веера встаёт в центр и НЕ приземляется — по правилам он стоит одной карты, оплата показывается рядом открыто; только после этого релиз садится в свой слот зоны (playToReleaseZone) и открывается окно атак. Атака летит с места соперника в центр (cardBoxIn — прицел по карточной коробке, не по всей сидушке) и ложится под своим наклоном. Ответ: защита накрывает атаку, обе уходят в сброс одним обменом (useDiscardExit, слои сохраняются). Своё судо встаёт в СВОЙ слот со стрелкой и складывается с выбранной защитой в пару через foldIntoPair — без дублей и телепортов: судо со стола передаётся флаеру тем же коммитом, поэтому оно ни на кадр не оказывается на экране дважды. Security Bug не жжёт релиз, а забирает его в зону атакующего — карта морфит в LOD прямо В ПОЛЁТЕ. Rollback возвращает атаку: без судо — в руку атакующего, с судо — в свою через useHandArrival. Промах мимо цели отменяет выложенное. То же теперь играется и на живом борде (#101): постановка релиза, оплата из веера и отмена — `_useBoardStaging.ts`, ответ на атаку (плейн или со своим судо) — `_useDefenseStaging.tsx`; что происходит дальше — `features/board-beats/defenseBeat.tsx` (`runCovered` — обмен и возврат Rollback, `runStolen` — переезд релиза в чужую зону с тем самым LOD-морфом в полёте) и `features/board-beats/comboBeat.tsx` (`runRelease`, оплата и постановка релиза — теперь для любого релиза, не только с Code Review). Fix A (#101) правит там же две вещи: свой ПЛЕЙН релиз летит в зону из СТАВОЧНОГО слота, где он и стоял (а не сворачивается из веера, откуда он давно ушёл), и статичный рендер снимается тем же коммитом, что поднимает носителя, — карта не оказывается на экране дважды; атака на борде теперь и ПОКОИТСЯ под своим наклоном, как накрывающая защита, поэтому уход в сброс стартует с той же позы, что была на экране. ОБНОВЛЕНО НА ЭТОЙ ВЕТКЕ: складывание защиты со своим судо идёт через шаг usePairFold(); строка «чего стол ждёт» стала компонентом кита AskLine, висящим на высоте центра; места центра сцена берёт из CENTRE_SETS, а не из своего CSS; посадка релиза в зону и подтыкание судо теперь на кривой LAND вместо SNAP — SNAP осталась там, где ей место, на появлении бейджа.',
      en: "a Release pulled from the fan stands at the centre and does NOT land — by the rules it costs one card, and the cost is shown beside it in the open; only then does the Release settle into its zone slot (playToReleaseZone) and the attack window opens. An attack flies from the opponent seat to the centre (cardBoxIn — aimed at the card box, not the whole seat) and lies at its own tilt. The answer: a defence covers the attack and both leave as one exchange (useDiscardExit, layers preserved). The player's own Sudo takes ITS OWN slot with an arrow and folds into a pair with the chosen defence via foldIntoPair — no duplicates and no teleports: the standing Sudo is handed to the flyer in the same commit, so it is never on screen twice for even a frame. Security Bug does not burn the release but takes it into the attacker zone — the card morphs into its LOD reading IN FLIGHT. Rollback sends the attack back: plain — to the attacker hand, under Sudo — to your own via useHandArrival. A press on nothing valid takes a staged play back. The same now also runs on the live board (#101): staging a Release, paying its cost out of the fan and cancelling it — `_useBoardStaging.ts`; answering an attack (plain or with the defender's own Sudo) — `_useDefenseStaging.tsx`; what happens once the engine answers — `features/board-beats/defenseBeat.tsx` (`runCovered` for the exchange and Rollback's return, `runStolen` for the release crossing into another zone with that very in-flight LOD morph) and `features/board-beats/comboBeat.tsx` (`runRelease`, the cost and placement — now for every Release, not only a Code-Review-paired one). Fix A (#101) corrects two things in the same place: the actor's own PLAIN release now flies to the zone out of the STAGE slot where it was actually standing (rather than folding in from a fan it had long left), with the static render let go in the same commit the carrier goes up so the card is never on screen twice; and the board's attack now also RESTS at its own tilt, like the cover already did, so its exit starts from the pose that was on screen. UPDATED ON THIS BRANCH: folding a defence with your own sudo goes through the usePairFold() step; the «what the table is waiting for» line became the AskLine kit component, hanging off the height of the centre; the scene takes its centre places from CENTRE_SETS rather than from its own CSS; and the release landing in its zone and the sudo tucking under now run on the LAND curve instead of SNAP, which stays where it belongs, on a badge appearing.",
    },
    where: 'DefenseRelease',
    board:
      'pages/board/[gameId]/_useBoardStaging.ts, pages/board/[gameId]/_useDefenseStaging.tsx, features/board-beats/defenseBeat.tsx, features/board-beats/comboBeat.tsx',
  },
  {
    name: {
      ru: 'Начало партии: интерфейс и раздача',
      en: 'The start of a match: interface and deal',
    },
    from: {
      ru: "две хореографии подряд. ПЕРВАЯ — приход интерфейса, вся на play('hudIn') с паузой BEAT между тактами: правая навигация въезжает от своего края (dx: 44), затем слой стола вместе с сеточкой чистым проявлением (dx/dy: 0), затем колоды слева (dx: -34) и сброс справа (dx: 34) со сдвигом PILE_STAGGER — не вместе, а друг за другом; последними места соперников падают сверху по одному (dy: -28, SEAT_STAGGER) и в тот же такт снизу поднимается док (dy: 30, DOCK_DELAY) — в состоянии «ход соперника», но с текстом «старт игры». Зоны релиза в этой очереди НЕТ. ВТОРАЯ — раздача по кругу, начиная с игрока, DEAL_STEP между картами и ROUND_GAP между кругами: карта игрока идёт drawToCenter в центр и ОСТАЁТСЯ там под своим scatterAt (один разброс ведёт и полёт, и покой — та же связка, что в сбросе), карта соперника уходит dealToSeat в cardBoxIn его места ×0.7 и растворяется в счётчике. Первый круг — Debugger, в открытую; остальное рубашкой. Что легло в центр, копится в локальный массив, а не читается из staged: замыкание не перезапускается, и staged в нём навсегда пустой (I8). Когда сели все пять — HEAP_HOLD, центр очищается в том же коммите, что стартует полёт, и вся кучка ОДНИМ useHandArrival уходит в веер (from = место карты в куче, rot её же) — всё ещё закрытой. FLIP_HOLD — рука переворачивается (Card играет flipCard сам, по faceDown). И только через REVEAL_HOLD hudIn выводит зону релиза игрока (dy: 22) — у него одного, у соперников её нет. Сцена вооружена started-рефом (StrictMode монтирует дважды), рестарт снимает его и перезапускает всё по key.",
      en: "two choreographies in a row. THE FIRST — the interface arriving, all of it on play('hudIn') with a BEAT between steps: the page rail slides in from its own edge (dx: 44), then the table layer with its grid as a plain fade (dx/dy: 0), then the decks from the left (dx: -34) and the discard from the right (dx: 34) offset by PILE_STAGGER — one after the other, not together; last the opponent seats drop in from above one by one (dy: -28, SEAT_STAGGER) and in the same beat the dock rises from below (dy: 30, DOCK_DELAY) — in its «opponent's turn» state but reading «game start». The release zone is NOT in this order. THE SECOND — the deal, round by round starting with the player, DEAL_STEP between cards and ROUND_GAP between rounds: the player's card goes drawToCenter to the centre and STAYS there at its own scatterAt (one scatter drives both flight and rest — the discard's own coupling), an opponent's card leaves dealToSeat into cardBoxIn of their seat ×0.7 and dissolves into the counter. The first round is the Debugger, dealt open; everything else face down. What landed at the centre is collected in a local array instead of read back off staged: the closure never re-runs, so staged in it stays the empty array it was (I8). When all five have landed — HEAP_HOLD, the centre empties in the same commit that starts the flight, and the whole heap goes into the fan with ONE useHandArrival (from = the card's place in the heap, rot its own) — still face down. FLIP_HOLD — the hand turns over (Card plays flipCard itself, off faceDown). And only after REVEAL_HOLD does hudIn bring in the player's release zone (dy: 22) — his alone, the opponents have none. The scene is armed with a started ref (StrictMode mounts twice); restart clears it and re-runs everything by key.",
    },
    where: 'GameDeal',
    board: 'features/game-intro/useDealIntro.ts',
  },
  {
    name: { ru: 'Конец партии', en: 'The end of a match' },
    from: {
      ru: "последний релиз вытягивается из веера и садится в свой слот (playToReleaseZone, SNAP) — зона закрыта. Дальше хлопушки: ТРИ независимых залпа (0 / 620 / 1450ms), у каждого своя сила — она задаёт число частиц, дальность и время в воздухе, поэтому это три события, а не один повтор. Залп — отдельный компонент: частицы создаются один раз и стартуют один раз в эффекте на монтирование (запуск из ref-колбэка убивал уже летящие: колбэк переприсваивается на каждом рендере, а play вешает вторую анимацию на летящий узел). Частица — свой символ кода, цвет-токен и ступень моно-шкалы; дуга — play('confettiFly'). Окно GameOver встаёт на 2.4s, ПОКА конфетти ещё летит, и конфетти идёт поверх окна. В плейграунде оба слоя начинаются под технической линией — она часть плейграунда, а не экрана.",
      en: "the last release is pulled out of the fan and settles into its slot (playToReleaseZone, SNAP) — the zone is closed. Then the poppers: THREE independent bangs (0 / 620 / 1450ms), each with its own power — it drives the piece count, the reach and the time in the air, so they are three events and not one repeat. A volley is its own component: the pieces are made once and started once in a mount effect (starting from a render-time ref callback killed the pieces already in the air: the callback re-fires on every render and play stacks a second animation on a node mid-flight). Every piece its own code symbol, colour token and step of the mono scale; the arc is play('confettiFly'). The GameOver window comes up at 2.4s WHILE the confetti is still flying, and the confetti flies over it. In the playground both layers start below the technical line — it belongs to the playground, not the screen.",
    },
    where: 'GameEnd',
  },
  {
    name: {
      ru: 'Карта уходит из руки в сброс (живой борд)',
      en: 'A card leaves the hand for the discard (live board)',
    },
    from: {
      ru: 'Первая хореография, которую ведут настоящие события движка, а не клики сцены. Приходит батч, planBeats сворачивает ВСЕ discarded этого батча в ОДИН такт (по одной, но все сразу — сброс по лимиту руки читается одним жестом, а не тремя). Планируется против проекции, которая ещё на экране: в живой карта уже вынута из руки вместе со слотом, из которого лететь (I1). Источник — свой слот веера (карта ищется по id: событие несёт id, а не uid), карточная коробка на сидушке соперника, либо слот зоны релиза для destroyed/neutralized. Разброс — scatterAt(id события), тот же вызов, которым куча в toBoardState кладёт карту на покой: одно значение, два читателя, поэтому передача от тени к проекции не двигает ни пикселя (I7). Рука при этом не блокируется: сброс — то, что СЛУЧИЛОСЬ, а не то, что решается. Раздача встала в ту же очередь тактом ноль — единственный такт, который держит стол и публикует свою тень вместо базы.',
      en: "The first choreography driven by real engine events rather than a scene's clicks. A batch arrives; planBeats folds EVERY discarded in it into ONE beat (one by one but all at once — a hand-limit discard reads as one gesture, not three). It is planned against the projection still on screen: in the live one the card is already out of the hand, and with it the slot to fly from (I1). The source is its own slot in the fan (found by card id — the event carries an id, not a uid), a card box on an opponent's seat, or a release-zone slot for destroyed/neutralized. The scatter is scatterAt(event id) — the same call the heap in toBoardState uses to rest the card: one value, two readers, so the handover from shadow to projection does not move a pixel (I7). The hand is never blocked: a discard is a thing that HAPPENED, not a thing being decided. The deal joined the same queue as beat zero — the one beat that holds the table and publishes its own shadow instead of a base.",
    },
    where: 'Card play (часть B)',
    board: 'features/board-beats/discardBeat.tsx',
  },
  {
    name: { ru: 'Стопка тостов чата', en: 'The chat toast stack' },
    from: {
      ru: "новых пресетов не потребовалось — вся хореография собрана из трёх готовых. Приход плашки — play('hudIn', { dy: 18, dur: 260 }) на монтировании: тот же «блок приходит на своё место», только снизу и коротко. Уход — play('popOut'), и снять плашку со сцены имеет право лишь она сама: очередь ставит ей leaving, плашка дожидается anim.finished и зовёт onLeft — снятие по таймеру оборвало бы анимацию на середине. Сдвиг соседей — FLIP через play('flyFrom', { from: прошлый rect, duration: 240 }): плашки РАЗНОЙ высоты (внутри чужая реплика, две строки или двенадцать), поэтому ехать «на шаг» нечем — rect меряется до и после коммита в useLayoutEffect, дельта у каждой своя. Новая плашка в этот замер не попадает: прошлого места у неё нет, у неё свой приход. Колонка прижата нижним краем и растёт вверх, поэтому уход самой старой (сверху) соседей не двигает вовсе, а уход средней опускает те, что над ней.",
      en: "no new presets were needed — the whole choreography is assembled from three existing ones. A plate arrives with play('hudIn', { dy: 18, dur: 260 }) on mount: the same «a block arrives at its place», only from below and short. It leaves with play('popOut'), and only the plate itself may take itself off the stage: the queue sets leaving, the plate awaits anim.finished and calls onLeft — dropping it on a timer would cut the animation in half. Neighbours shift by FLIP through play('flyFrom', { from: the previous rect, duration: 240 }): the plates are of DIFFERENT heights (someone else's reply inside, two lines or twelve), so there is no «one step» to move by — the rect is measured before and after the commit in useLayoutEffect and every delta is its own. A newly arrived plate is not in that measurement: it has no previous place, it has its own arrival. The column is pinned to the bottom and grows upward, so the oldest leaving (from the top) moves no neighbours at all, while a middle one leaving lowers those above it.",
    },
    where: 'blocks/Toast (ToastStack), Table + chat',
  },
]

// ===== 3. Needs rework — THE register of findings =====
// Everything found about the animations lands here: this page is where the work
// is looked at, so it is where a finding has to be visible. Two kinds live side
// by side, and the status tells them apart:
//   • what is VISIBLE in the scenes — a movement written twice, a ready module
//     not used (rework / reuse). The rule: a movement that exists in two scenes
//     is a module that has not been packaged yet.
//   • what CANNOT be seen in a scene — a rule nobody decided, a value out of
//     reach (open). The long form of these — what it costs and what would close
//     it — is in docs/animations/backlog.md; here they are visible, there they
//     are actionable.
const ISSUES: Issue[] = [
  {
    what: {
      ru: 'Промах Security Bug нечем показать — правило есть, такта нет',
      en: 'A missed Security Bug has nothing to show it — the rule exists, the beat does not',
    },
    problem: {
      ru: 'Владелец правил решил (22.08.2026, docs/rules/cards.md): запрос Security Bug публичен и при попадании, и при промахе — стол видит, какую карту запросили, и при промахе тоже должен увидеть, какую запросили и не получили. Был показан только удачный путь: карта соперника выбирается и открыто уезжает к атакующему (PickSpecificCardStory), а промах не показан ничем — карта атаки просто уходила в сброс. РЕШЕНО #105: промах несёт runRequested (features/board-beats/transferBeat.tsx), и несёт публично. Событие requested уходит без visibleTo, его поле hit приезжает всем, поэтому на КАЖДОМ пире названная карта поднимается в центре (popIn), стоит REQUEST_HOLD = 820, цель вздрагивает — play(«shake») характером spring, amp 9 / 460ms, — показывается подпись table.requestMiss, и через MISS_HOLD = 1620 сцена гаснет. На промахе пендинг снимается сразу, так что такт несёт всю сцену целиком или стол не узнаёт исхода вовсе. Цель вздрагивает В ТОМ ВИДЕ, в каком нарисована: её МЕСТО (seatOf) — всем смотрящим, её собственный веер (anchors.hand) — ей самой, у которой места нет. Вторая половина ответа владельца — «публичен и сам процесс выбора» — закрыта тем же заходом: выбор идёт в полосе CardCatalog, а на попадании названная карта стоит в центре у всех (giveCard проецируется без гейта mine).',
      en: "The rules owner decided (22.08.2026, docs/rules/cards.md) that a Security Bug request is public on a hit and on a miss alike — the table sees which card was asked for, and on a miss must likewise see which card was asked for and not received. Only the successful path was shown: the opponent card chosen and travelling to the attacker in the open (PickSpecificCardStory), with the miss shown by nothing — the attack card simply went to the discard. RESOLVED in #105: the miss is carried by runRequested (features/board-beats/transferBeat.tsx), and carried publicly. The requested event has no visibleTo and its hit field reaches everyone, so on EVERY peer the named card rises at the centre (popIn), stands for REQUEST_HOLD = 820, the target flinches — play('shake') in its spring character, amp 9 / 460ms — the table.requestMiss note shows, and after MISS_HOLD = 1620 the scene clears. On a miss the pending clears outright, so the beat carries the whole scene or the table never learns the outcome at all. The target flinches AS IT IS RENDERED: their SEAT (seatOf) to everyone watching, their own fan (anchors.hand) to the target themselves, who has no seat. The second half of the owner's answer — that the choosing is public too — is closed by the same pass: the pick happens in the CardCatalog band, and on a hit the named card stands at the centre for everyone (giveCard is projected with no mine gate).",
    },
    where: {
      ru: 'features/board-beats/transferBeat.tsx (runRequested) + pages/board/[gameId]/_Board.tsx (карта в центре) + docs/rules/cards.md:125-129 (правило)',
      en: 'features/board-beats/transferBeat.tsx (runRequested) + pages/board/[gameId]/_Board.tsx (the card at the centre) + docs/rules/cards.md:125-129 (the rule)',
    },
    status: 'ok',
  },
  {
    what: {
      ru: 'Правила ставят Security Bug в центр на время выбора — движок её уже сбанчил',
      en: 'The rules stand a Security Bug at the centre while the asker chooses; the engine has banked it',
    },
    problem: {
      ru: 'docs/rules/cards.md:126: атакующая карта лежит в центре стола всё время, пока атакующий выбирает, — «это и есть демонстрация, что её разыграли». onHandDefend (packages/engine/src/fake/attacks.ts:191) отправляет её в сброс через bankSpent(…, «attackSpent») в ТОЙ ЖЕ редукции, которая поднимает pending: requestCard (там же, :203). То есть к моменту выбора проекция уже держит карту атаки в куче. Борд не может поставить в центр карту, про которую проекция говорит «она в сбросе»: это второй источник правды о её местоположении, и он разойдётся с кучей на первом же разборе. Поэтому на время requestCard не-атакующие получают строку в доке и пустой центр — публичное по правилам действие приходит к столу без своей улики. Расхождение правил с движком, а не визуальная недоделка: тактом не закрывается, любая попытка закрыть на борде будет выдумкой про местоположение карты. Закроет: движок паркует карту атаки на самом пендинге requestCard — как defend уже паркует брошенную атаку — и снимает её в сброс тем же переходом, что закрывает пендинг. Изменение поведения движка со своей conformance-поверхностью, поэтому записано, а не сделано в #105.',
      en: "docs/rules/cards.md:126: the attack card lies at the centre for the whole table while the attacker chooses — «this is the demonstration that it was played». onHandDefend (packages/engine/src/fake/attacks.ts:191) banks it with bankSpent(…, 'attackSpent') in the SAME reduction that raises pending: requestCard (ibid., :203), so by the time anybody is choosing, the projection already has it in the discard heap. The board cannot stand a card at the centre that the projection says is in the heap: that is a second source of truth about where the card is, and it parts company with the heap at the first inspection. So during requestCard non-askers get the dock line and an empty centre — an action the rules call public reaches the table without the evidence the rule exists for. A rules-versus-engine gap, not a visual shortfall: no beat closes it, and any attempt to close it on the board would be an invention about where the card is. What closes it: the engine parking the attack card on the requestCard pending — the way defend already parks a thrown attack — and moving it to the discard in the same transition that closes the pending. An engine behaviour change with its own conformance surface, which is why it is recorded rather than done in #105.",
    },
    where: {
      ru: 'packages/engine/src/fake/attacks.ts:191-208 + docs/rules/cards.md:126',
      en: 'packages/engine/src/fake/attacks.ts:191-208 + docs/rules/cards.md:126',
    },
    status: 'open',
  },
  {
    what: {
      ru: 'Сторонний игрок не видит передачи карты вообще — событие до него не доезжает',
      en: 'A bystander sees no transfer at all — the event never reaches them',
    },
    problem: {
      ru: 'handTransfer логируется с visibleTo: [from, to] в обеих точках, где вообще возникает (packages/engine/src/fake/handAttacks.ts:61 — случайная кража, :230 — отдача по запросу), а forViewer (apps/frontend/src/network/session/audience.ts:11) выбрасывает событие ЦЕЛИКОМ у всех, кого нет в списке. redactFor (packages/engine/src/redact.ts) умеет ровно обратное — вырезать секретное ПОЛЕ, оставив событие на месте, — но знает только про drawn. Значит нога watcher в transferBeat.tsx в проде недостижима: сторонний игрок не получает ничего, и у двух соперников просто меняются счётчики руки. Это тот же самый отказ, который описан в шапке самого redact.ts про добор («добор соперника доезжал до остальных пиров ничем — событие анимировать нечего, только счётчик руки тикнул»), вернувшийся потому, что починку не обобщили: drawn вылечили поимённо, а handTransfer завели заново с той же ошибкой. Закроет: снять visibleTo с обеих точек handTransfer и расширить redactFor, чтобы она вырезала card у не-участников, — ровно как уже делает для drawn. Строго больше информации о ТОМ, ЧТО передача была, и ноль — о ТОМ, ЧТО именно переехало; нога watcher при этом не меняется ни строкой.',
      en: "handTransfer is logged with visibleTo: [from, to] at both sites where it exists at all (packages/engine/src/fake/handAttacks.ts:61 — the random steal, :230 — the hand-over on request), and forViewer (apps/frontend/src/network/session/audience.ts:11) drops the event ENTIRELY for anyone not on the list. redactFor (packages/engine/src/redact.ts) does the opposite — strips a secret FIELD and keeps the event — but knows only about drawn. So the watcher leg in transferBeat.tsx is unreachable in production: a bystander gets nothing, and two opponents' hand counts simply change. This is the very failure redact.ts's own header describes for draws («an opponent's draw reached other peers as nothing at all — no event to animate, only a hand count that ticked up»), recurring because the fix was never generalised: drawn was cured by name and handTransfer was introduced with the same mistake. What closes it: drop visibleTo from both handTransfer sites and extend redactFor to strip card for non-parties, exactly as it already does for drawn. Strictly more information about THAT a transfer happened and none about WHAT moved; the watcher leg does not change by a line.",
    },
    where: {
      ru: 'packages/engine/src/fake/handAttacks.ts:61,230 + network/session/audience.ts:11 + packages/engine/src/redact.ts',
      en: 'packages/engine/src/fake/handAttacks.ts:61,230 + network/session/audience.ts:11 + packages/engine/src/redact.ts',
    },
    status: 'open',
  },
  {
    what: {
      ru: 'Правила не говорят, узнаёт ли стол, какую карту забрала случайная кража',
      en: 'The rules do not say whether the table learns which card a random steal took',
    },
    problem: {
      ru: 'docs/rules/cards.md:112 (Bug / Out of Memory / Legacy Code) говорит только «Взять одну случайную карту из руки соперника» — и ни слова о том, видит ли стол, какая карта переехала. Для Security Bug тот же файл решает это прямо (cards.md:127: «стол видит открыто, какую карту запросили, и видит открытую передачу»), для случайной кражи — молчит. Разница между двумя прочтениями видна только на экране и ничем больше не проверяется. Борд сегодня отдаёт card двум участникам, и сторонний игрок в обоих случаях не узнаёт ничего, — но это следствие устройства события, а не решение по правилам, и с одним из прочтений оно совпадает случайно. Догадаться «по смыслу» тут особенно легко и особенно опасно: под догадку уже написан такт, она закрепится тестом и станет источником, по которому сверятся следующие. Обратная сторона тоже стоит денег: если стол ДОЛЖЕН видеть, какую карту забрали случайно, нога watcher обязана перестать быть закрытой, а это другой такт, а не параметр. Закроет ответ владельца правил одной строкой в cards.md, на месте абзаца про эффект на руку. Здесь ответ не выдумывается: проект прямо запрещает дорешивать правила по смыслу.',
      en: "docs/rules/cards.md:112 (Bug / Out of Memory / Legacy Code) says only «take one random card from an opponent's hand» — not a word about whether the table sees which card moved. For Security Bug the same file settles it outright (cards.md:127: «the table sees in the open which card was asked for, and sees the transfer in the open»); for the random steal it is silent. The difference between the two readings is visible on screen and checked by nothing else. The board today gives card to the two parties, and a bystander learns nothing in either case — but that follows from the shape of the event rather than from a rules decision, and it coincides with one of the readings by accident. Guessing «by the sense of it» is especially easy and especially dangerous here: a beat is already written against the guess, a test would pin it, and it would become the source the next task checks against. The other side costs too: if the table MUST see which card a random steal took, the watcher leg has to stop being closed, and that is a different beat rather than a parameter. What closes it: an answer from the rules owner, one line in cards.md at the hand-effect paragraph. No answer is invented here — the project forbids settling rules by inference.",
    },
    where: {
      ru: 'docs/rules/cards.md:112 (молчит) vs :127 (решено для Security Bug); заведено вопросом в docs/rules/backlog.md',
      en: 'docs/rules/cards.md:112 (silent) vs :127 (settled for Security Bug); filed as an open question in docs/rules/backlog.md',
    },
    status: 'open',
  },
  {
    what: {
      ru: 'Метка «Не из правил» в cards.md не поставлена — по ней разъехались бы 18 указателей',
      en: 'The «not from the rules» marker is missing from cards.md — adding it would shift 18 pointers',
    },
    problem: {
      ru: 'Правило проекта (CLAUDE.md) требует, чтобы открытый вопрос по правилам стоял в двух местах: записью в docs/rules/backlog.md и меткой «> ❓ Не из правил.» в самом абзаце спеки, из которого он вырос. Для вопроса выше (видит ли стол, какую карту забрала случайная кража) запись заведена, а метка в cards.md — нет, и это осознанный отказ, а не забывчивость. Вставка метки сдвигает все строки ниже 112, а на docs/rules/cards.md:NNN завязаны ссылки по номеру строки: grep -ro «cards\\.md:[0-9]+» apps packages docs возвращает сегодня 40 совпадений (:125 — 11, :112 — 11, :126 — 7, :320 — 6, :127 — 4, :339 — 1). Из них 18 — настоящие указатели в коде, тестах, спеках и прозе рецептов; остальные 22 — проза самих находок про эту самую проблему (docs/rules/backlog.md, docs/animations/backlog.md и эта страница), то есть счётчик включает собственный текст и растёт от того, что долг обсуждают. Оба числа нужны: 18 — сколько придётся перепривязать, чтобы указатели продолжили работать, 40 — что возвращает объявленная команда. ВСЕ совпадения указывают на 112 или ниже, то есть на точку вставки или за неё. Соблюсти правило буквально значит молча сдвинуть все восемнадцать рабочих указателей, и каждая неверная перепривязка — свежий тихий дефект ровно того класса, который #105 и разгребал. Цена отказа своя: читатель cards.md:112 не узнает, что абзац спорный, — вопрос виден только из backlog. Закроет переход на ссылки по якорю или заголовку вместо номера строки; после него вставка строк перестаёт что-либо ломать, и метка идёт в абзац, как правило и требует. До тех пор метка считается ДОЛЖНОЙ, а не отменённой.',
      en: "The project rule (CLAUDE.md) requires an open rules question to stand in two places: an entry in docs/rules/backlog.md and a «> ❓ Не из правил.» marker in the very paragraph of the spec it came from. For the question above (does the table learn which card a random steal took) the entry exists and the cards.md marker does not — a deliberate refusal, not an oversight. Inserting the marker shifts every line below 112, and citations are anchored to docs/rules/cards.md:NNN by line number: grep -ro «cards\\.md:[0-9]+» apps packages docs returns 40 matches today (:125 — 11, :112 — 11, :126 — 7, :320 — 6, :127 — 4, :339 — 1). Of those, 18 are real pointers in code, tests, specs and recipe prose; the other 22 are the findings' own prose about this very problem (docs/rules/backlog.md, docs/animations/backlog.md and this page) — that is, the count includes its own text and grows as the debt is discussed. Both numbers matter: 18 is what has to be re-anchored to keep the pointers working, 40 is what the stated command returns. ALL matches point at 112 or below, that is at the insertion point or past it. Following the rule literally means silently shifting all eighteen working pointers, and every wrong re-anchoring is a fresh silent defect of exactly the class #105 was cleaning up. The refusal has its own cost: a reader of cards.md:112 will not learn the paragraph is disputed — the question is visible only from the backlog. What closes it: citing cards.md by anchor or heading instead of line number, after which inserting lines breaks nothing and the marker goes into the paragraph as the rule asks. Until then the marker is OWED, not waived.",
    },
    where: {
      ru: 'docs/rules/backlog.md (запись заведена) + docs/rules/cards.md:112 (метки нет)',
      en: 'docs/rules/backlog.md (the entry is filed) + docs/rules/cards.md:112 (no marker)',
    },
    status: 'open',
  },
  {
    what: {
      ru: 'Рецепт, разошедшийся со своей сценой, не роняет ничего',
      en: 'A recipe that has drifted from its scene fails nothing',
    },
    problem: {
      ru: 'apps/ui/src/animations/docs.test.ts роняет сборку, если у пресета нет строки в reference.md; stories/docs.test.ts — если у модуля со страницы нет упоминания в reference.md, если у анимированной сцены нет «живой ссылки» в recipes.md и если board-путь указывает на несуществующий файл. Ни одна проверка не смотрит, ОПИСЫВАЕТ ли рецепт ту сцену, которую сам назвал живой ссылкой: наличие ссылки проверяется, соответствие — нет. Уже стоило двух рецептов, оба чинились в #105. «Opponent takes your card» описывал двухшаговый перелёт в центр ЧУЖОГО ВЕЕРА с rotate(180) и падением zIndex до 30; сцена с коммита 440bc56 — того самого, которым заведена docs/animations/, — рисует соперников Seat’ами. «Taking an opponent’s card» описывал грид из gridPositions, ORIGIN, COLS_MAX, DEAL_CARD_W и slotRefs, а PickOpponentCardStory рисует Hand faceDown, съезжающий сверху; по всему репозиторию эти пять имён есть только в GameEndStory, ComboStory, glossary.md и самом recipes.md — грида не было никогда. Класс живой и не исчерпан: строка DEAL_CARD_W | 150 | PickOpponentCardStory в glossary.md называет константу, которой нет нигде, а шаг 2 рецепта «Take a specific card» не знает про confirmWanted и ConfirmAction. Опаснее обычной дыры тем, что доки читают ВМЕСТО кода. Закроет проверка, которая берёт у каждого рецепта его живую ссылку, читает названный файл сцены и требует, чтобы имена, написанные рецептом в обратных кавычках, в этом файле встречались.',
      en: "apps/ui/src/animations/docs.test.ts fails the build when a preset has no row in reference.md; stories/docs.test.ts fails when a module on this page is not mentioned in reference.md, when an animated scene has no «Live reference» in recipes.md, and when a board path points at a file that is gone. None of them checks whether a recipe still DESCRIBES the scene it named as its live reference: the link's presence is checked, its truth is not. It has already cost two recipes, both repaired in #105. «Opponent takes your card» described a two-hop flight into an OPPONENT FAN's centre with rotate(180) and zIndex dropping to 30; the story has rendered opponents as Seats since 440bc56 — the very commit that introduced docs/animations/. «Taking an opponent's card» described a grid built from gridPositions, ORIGIN, COLS_MAX, DEAL_CARD_W and slotRefs, while PickOpponentCardStory renders a Hand faceDown sliding down from the top; repo-wide those five names live only in GameEndStory, ComboStory, glossary.md and recipes.md itself — the grid never existed. The class is live and not exhausted: the row DEAL_CARD_W | 150 | PickOpponentCardStory in glossary.md names a constant that exists nowhere, and step 2 of the «Take a specific card» recipe does not know about confirmWanted or ConfirmAction. More dangerous than an ordinary hole, because the docs are read INSTEAD of the source. What closes it: a test that takes each recipe's live reference, reads the named story file and asserts that the identifiers the recipe writes in backticks actually appear in it.",
    },
    where: {
      ru: 'apps/playground/stories/docs.test.ts + apps/ui/src/animations/docs.test.ts + docs/animations/recipes.md',
      en: 'apps/playground/stories/docs.test.ts + apps/ui/src/animations/docs.test.ts + docs/animations/recipes.md',
    },
    status: 'open',
  },
  {
    what: {
      ru: 'Происхождение клипов вылета никем не подтверждено',
      en: 'Nobody has confirmed where the elimination clips came from',
    },
    problem: {
      ru: 'Четыре `.mp4` из папки сцены (`freshleb-whistlindiesel`, `gato-truco-gato` и два безымянных) переехали в `apps/frontend/src/features/board-beats/eliminate/` и теперь собираются в продуктовый билд (#103). В плейграунде это была песочница, в продукте — раздача чужого материала: ни лицензии, ни автора, ни источника ни у одного из четырёх. Задача #103 везёт их как есть намеренно — без клипов такт нечем ни показать, ни проверить, — но перед релизом их нужно либо очистить по правам, либо заменить своими. Закроет решение по каждому клипу: подтверждённая лицензия или замена. Механика такта от этого не меняется ни на строку — `ELIMINATION_CLIPS` собирается глобом, файлы подменяются как файлы.',
      en: 'Four `.mp4`s out of the story folder (`freshleb-whistlindiesel`, `gato-truco-gato` and two unnamed) moved into `apps/frontend/src/features/board-beats/eliminate/` and now ship in the product build (#103). In the playground that was a sandbox; in the product it is redistributing somebody else’s material — not one of the four carries a licence, an author or a source. Task #103 ships them as they are on purpose (without clips there is no beat to show or to test), but before release they must be cleared or replaced. What closes it is a decision per clip: a confirmed licence, or a replacement. None of it touches the beat — `ELIMINATION_CLIPS` is a glob, and files are swapped as files.',
    },
    where: {
      ru: 'frontend: features/board-beats/eliminate/*.mp4',
      en: 'frontend: features/board-beats/eliminate/*.mp4',
    },
    status: 'open',
  },
  {
    what: {
      ru: 'У ответа Monitoring на 503 нет движения вообще',
      en: 'Answering a 503 with Monitoring has no movement at all',
    },
    problem: {
      ru: 'Три метода отвечают на Error 503, и у двух жест — полёт: Debugger из веера, релиз из своей зоны, оба в слот прикрытия (playToCenter, поза COVER_POSE). У Monitoring движения нет ни одного: карта отвечает оттуда, где стоит, и там же остаётся. Утверждённый источник (Error503Story) жеста под него не содержит — история выстреливала Monitoring сама. Отправить его в центр и вернуть — соврать про произошедшее, поэтому в задаче 9 (#102) сделано минимальное честное: нажатие шлёт RESOLVE и не двигает ничего. Ценой того, что единственный ответ из трёх остаётся без подтверждения на месте. Закроет пресет «карта отработала, не уходя» (вспышка/пульс на самом слоте) — в словаре такого нет.',
      en: 'Three methods answer an Error 503, and two of them are a flight: the Debugger out of the fan, a release out of your own zone, both to the cover slot (playToCenter at COVER_POSE). Monitoring has no movement at all — it answers from where it stands and stays there. The approved source (Error503Story) carries no gesture for it, because the story auto-fired it. Flying it to the centre and back would be a lie about what happened, so Task 9 (#102) ships the smallest honest thing: the press sends the RESOLVE and moves nothing. The cost is that one answer of the three gets no confirmation in place. What closes it is a preset for “this card acted without leaving” (a flash/pulse on the slot itself) — the vocabulary has none.',
    },
    where: {
      ru: 'frontend: pages/board/[gameId]/_useNeutralizeStaging.tsx + ui: animations/',
      en: 'frontend: pages/board/[gameId]/_useNeutralizeStaging.tsx + ui: animations/',
    },
    status: 'open',
  },
  {
    what: {
      ru: 'Два `useFlyer` на одной странице сталкиваются ключами React',
      en: 'Two `useFlyer`s on one page collide on React keys',
    },
    problem: {
      ru: '`useFlyer` нумерует узлы приватным счётчиком (`seq` — React-ключ узла в `overlay`, инвариант I5: свежий узел на каждый полёт), и у каждого экземпляра он начинается с нуля. `overlay` при этом склеивается сценой с чужими массивами, так что первый поднятый носитель в двух экземплярах даёт двух детей с ключом `1` (с `useHandArrival` столкновения нет — там ключи строковые). Правила «сколько носителей на странице» не решено вовсе. Достижимо на защите: судо ещё летит к своему слоту, игрок кликает партнёра, и фолд поднимает второй носитель, пока первый в воздухе. Найдено при выделении `_useCoverFlight.ts` (#102): двум слотам одного стола нужны независимые гейты `landed`, то есть два экземпляра модуля, который владеет носителем. Обойдено в открытую — `useCoverFlight(shared?)` принимает уже существующий носитель, и `_useDefenseStaging.tsx` отдаёт обоим экземплярам ОДИН свой `useFlyer`. Закроет ключ, уникальный по экземпляру: `useId()` в `useFlyer` и `key` из пары «идентификатор + seq».',
      en: '`useFlyer` numbers its nodes from a private counter (`seq` — the React key of the node in `overlay`, invariant I5: a fresh node per flight), and every instance starts it at zero. `overlay` is then concatenated by the scene with other arrays, so the first carrier raised in two instances yields two children keyed `1` (no clash with `useHandArrival`, whose keys are strings). The rule for how many carriers a page may hold is undecided. Reachable on the defence: the Sudo is still flying to its slot, the player clicks a partner, and the fold raises a second carrier while the first is in the air. Found while extracting `_useCoverFlight.ts` (#102): two slots on one table need independent `landed` gates, i.e. two instances of a module that owns the carrier. Worked around in the open — `useCoverFlight(shared?)` accepts an existing carrier, and `_useDefenseStaging.tsx` hands both instances its ONE `useFlyer`. What closes it is a key unique per instance: `useId()` inside `useFlyer`, and a key built from identifier + seq.',
    },
    where: {
      ru: 'ui: animations/useFlyer.tsx (overlay key) + frontend: pages/board/[gameId]/_useCoverFlight.ts',
      en: 'ui: animations/useFlyer.tsx (overlay key) + frontend: pages/board/[gameId]/_useCoverFlight.ts',
    },
    status: 'open',
  },
  {
    what: {
      ru: 'Модуль, не записанный НИГДЕ, не виден ни одной проверке',
      en: 'A module written down NOWHERE is invisible to every check',
    },
    problem: {
      ru: 'Про доку, не про игровую логику. Три вещи обязаны сюда доезжать, и две с половиной проверены машиной: пресет без строки в reference.md роняет тест; модуль, который есть на этой странице, но не упомянут в reference.md, роняет тест; сцена без «живой ссылки» в recipes.md роняет тест. Но все три сверяют ДВЕ точки друг с другом — значит модуль, не дошедший ни до одной, невидим для всех сразу. Так и вышло с экранным выключателем параллакса: написан, работает в настройках стола, не значился ни здесь, ни в доках. Опаснее прочего тем, что тесты при этом зелёные — возникает ложное чувство покрытия. Автоматически не закрывается: отличить модуль от вспомогательной функции может только человек. Закрывает дисциплина на входе — модуль считается сделанным, когда он появился ЗДЕСЬ, дальше его дотянет тест. — ОТВЕТ ВЛАДЕЛЬЦА: для этого кожаные мешки и сидят за компьютерами, чтобы всё не сломалось. Автоматизировать нечего: любая новая проверка сверит те же две точки. Держим правилом на входе.',
      en: 'About the docs, not the game logic. Three things are supposed to land here, and two and a half are machine-checked: a preset with no row in reference.md fails a test; a module that is on this page but unmentioned in reference.md fails a test; a scene with no live reference in recipes.md fails a test. But all three compare TWO places with each other — so a module that reached neither is invisible to all of them at once. That is exactly what happened to the screen-wide parallax switch: written, working in the table settings, listed neither here nor in the docs. What makes it worse than an ordinary gap is that the tests stay green, which reads as coverage. It does not close automatically — telling a module from a helper takes a person. What closes it is discipline at the door: a module counts as done once it appears HERE, and the test drags it into the docs from there. — OWNER: this is what humans at computers are for. Nothing to automate: any new check would compare the same two points. It stays a rule at intake.',
    },
    where: { ru: 'эта страница + docs/animations/', en: 'this page + docs/animations/' },
    status: 'open',
  },
  {
    what: {
      ru: '`drawn` был приватным, добор соперника было нечем анимировать',
      en: '`drawn` was private, an opponent’s draw had nothing to animate',
    },
    problem: {
      ru: 'Issue #97 утверждал, что `drawn` уже опускает `card` для чужого добора и проекция уже нужной формы — это было неверно: движок ставил `visibleTo: [drawer]` на обычный добор, и сеть роняла всё событие целиком у всех, кроме доборщика (`network/session/audience.ts`), так что соперник не получал ничего, кроме тика счётчика руки. Решено этой задачей: `reduce.ts` больше не ставит `visibleTo`, событие публично для всех, а секретность личности карты вынесена в `@release/engine`.`redactFor(event, viewerId)` — она вырезает `card` из чужого `drawn`, и `forViewer` фильтрует по `visibleTo` как раньше, затем прогоняет уцелевшее через неё. Запись держится тут намеренно даже решённой: исходный текст issue продолжает утверждать обратное.',
      en: 'Issue #97 claimed `drawn` already omitted `card` for an opponent’s draw and the projection was already the right shape — that was wrong: the engine set `visibleTo: [drawer]` on an ordinary draw, and the network dropped the whole event for everyone but the drawer (`network/session/audience.ts`), so an opponent got nothing but a tick of the hand counter. Resolved by this task: `reduce.ts` no longer sets `visibleTo`, the event is public to everyone, and the card’s identity secrecy moved into `@release/engine`’s `redactFor(event, viewerId)` — it strips `card` from someone else’s `drawn`; `forViewer` filters by `visibleTo` as before, then runs the survivors through it. The entry stays here on purpose even though it is solved: the original issue text still states the opposite.',
    },
    where: {
      ru: 'packages/engine (redactFor) + network/session/audience.ts (forViewer)',
      en: 'packages/engine (redactFor) + network/session/audience.ts (forViewer)',
    },
    status: 'ok',
  },
  {
    what: {
      ru: '`pilesChanged` не называет ни операцию, ни индекс разделения',
      en: '`pilesChanged` names neither its operation nor the split index',
    },
    problem: {
      ru: 'Событие несёт только счётчики (`piles: number[]`), ни какая операция произошла, ни какая стопка в ней участвовала — без вывода нечем решить, `flyFrom` целится в какой индекс или `absorbToDeck` во что. `classifyPiles` (`planBeats.ts`) выводит это позиционно: длина + сумма стопок до/после, с вычерпыванием, проверяемым раньше мёрджа (обе формы дают одну длину результата). Вычерпывание (prune) при этом не заводит отдельный вид `PileStep` — пустой пропавшей стопке нечего анимировать, и функция просто возвращает `null`. — ОТВЕТ ВЛАДЕЛЬЦА: не на моей стороне. Правка в движке: событие называет операцию и индекс, такт читает вместо вывода. Вывод по числам держится, пока у операций разная форма счётчиков, а на колодах Git Branch/Merge формы совпадут.',
      en: 'The event carries only counts (`piles: number[]`) — neither which operation ran nor which pile it touched, so nothing tells `flyFrom` which index to aim at or `absorbToDeck` what to absorb into. `classifyPiles` (`planBeats.ts`) derives it positionally instead — length and sum of the pile counts before/after, with the prune case checked ahead of merge (both shapes yield the same result length). A prune does not get its own `PileStep` variant either — an empty pile that ceased to exist has nothing on screen to animate, so the function just returns `null`. — OWNER: not on my side. The fix is in the engine: the event names its operation and index and the beat reads it instead of deriving. The positional derivation holds only while the operations have different count shapes, and on Git Branch/Merge decks they coincide.',
    },
    where: {
      ru: 'frontend: features/board-beats/planBeats.ts (classifyPiles)',
      en: 'frontend: features/board-beats/planBeats.ts (classifyPiles)',
    },
    status: 'rework',
  },
  {
    what: {
      ru: 'Сколько триггер стоит в центре — значения нет',
      en: 'How long a revealed trigger stands at the centre — no approved value',
    },
    problem: {
      ru: 'Такт добора держит вскрытый триггер на столе `REVEAL_HOLD = 900` перед уходом в сброс. `DrawCardStory` держит `AI_HOLD = 4000`, но это пауза AI-ветки (стол читает эффект), не обычного вскрытия — а для голого reveal подтверждённого значения нет вовсе. `REVEAL_HOLD = 900` — число этой задачи, ничем не подтверждённое. — ОТВЕТ ВЛАДЕЛЬЦА: значение берётся из сцены-примера, и сцена здесь — AI cards (поведение карт AI в центре её предмет), а не Draw card (её предмет колоды добора). Найдено: TABLE_HOLD = 2600, у Галлюцинации вдвое дольше. Осталась правка на борде. — ЗАКРЫТО (#106): правка сделана. `REVEAL_HOLD = 900` больше не существует — `drawBeat.tsx` держит вскрытый (не-AI) триггер на `TABLE_HOLD`, импортированным из `features/board-beats/toCentre.ts`, тем же модулем, которым теперь держит свою пару и AI-карта (`aiBeat.tsx`). Одно число, оба читателя.',
      en: 'The draw beat holds a revealed trigger at the centre for `REVEAL_HOLD = 900` before it leaves for the discard. `DrawCardStory` has `AI_HOLD = 4000`, but that is the AI branch’s pause (the table reads the effect), not a plain reveal’s — and a plain reveal has no approved value at all. `REVEAL_HOLD = 900` is this task’s own number, unconfirmed by anything. — OWNER: the value comes from the example scene, and the scene here is AI cards (the behaviour of AI cards at the centre is its subject), not Draw card (whose subject is the draw piles). Found: TABLE_HOLD = 2600, twice as long for Hallucination. The board edit is what is left. — CLOSED (#106): the edit is made. `REVEAL_HOLD = 900` no longer exists — `drawBeat.tsx` holds a revealed (non-AI) trigger on `TABLE_HOLD`, imported from `features/board-beats/toCentre.ts`, the same module the AI card now holds its own pair on (`aiBeat.tsx`). One number, both readers.',
    },
    where: {
      ru: 'frontend: features/board-beats/drawBeat.tsx, features/board-beats/toCentre.ts (TABLE_HOLD)',
      en: 'frontend: features/board-beats/drawBeat.tsx, features/board-beats/toCentre.ts (TABLE_HOLD)',
    },
    status: 'ok',
  },
  {
    what: {
      ru: '`drawBeat` меряет якоря без `nextFrames` — мёрдж в том же батче уронит добор',
      en: '`drawBeat` measures anchors without `nextFrames` — a same-batch merge would drop the draw',
    },
    problem: {
      ru: '`toCentre` в `drawBeat.tsx` меряет `pileBox`/`centre` на входе такта без `await nextFrames()`, хотя `discardBeat`/`deckBeat` уже платят этот вызов за ровно тот же layout-эффект. Сходит с рук только потому, что добор не убирает стопку; `[drawn(pile 2), pilesChanged → merge]` вернёт `pileBox(2) === null` и уронит добор целиком — недостижимо до #108 (Git Branch/Merge с борда). Стаб анкоров в тесте тоже не переработан, в отличие от `deckBeat.test.tsx`. — ОТВЕТ ВЛАДЕЛЬЦА снял посылку «недостижимо»: у добора есть логика исчезновения стопки, и она описана в правилах (resolution.md §8) — опустевшая колода перестаёт существовать, а на последней сброс перемешивается и становится новой колодой добора. Значит батч «добор + исчезновение стопки» это обычный ход, а не будущий край: добор пропадёт молча уже сегодня. Правка одна строка, тем же приёмом, что оплачен в discardBeat и deckBeat.',
      en: '`toCentre` in `drawBeat.tsx` measures `pileBox`/`centre` at beat entry with no `await nextFrames()`, though `discardBeat`/`deckBeat` already pay that call against the same layout-effect hazard. It gets away with it only because a draw never removes a pile; `[drawn(pile 2), pilesChanged → merge]` would return `pileBox(2) === null` and drop the draw entirely — unreachable until #108 (Git Branch/Merge from the board). The test’s anchors stub is not reworked either, unlike `deckBeat.test.tsx`. — THE OWNER removed the "unreachable" premise: a draw does remove piles, and the rules describe it (resolution.md §8) — an emptied pile ceases to exist, and on the last one the discard is shuffled into a new draw deck. So the batch of a draw plus a pile disappearing is an ordinary turn rather than a future edge: the draw already goes missing, silently. The fix is one line, the same one already paid for in discardBeat and deckBeat.',
    },
    where: {
      ru: 'frontend: features/board-beats/drawBeat.tsx (toCentre)',
      en: 'frontend: features/board-beats/drawBeat.tsx (toCentre)',
    },
    status: 'open',
  },
  {
    what: {
      ru: 'Сброс после `[drawn(mine), discarded]` может целиться в слот, соседний с верным',
      en: 'A discard after `[drawn(mine), discarded]` can aim next to the right hand slot',
    },
    problem: {
      ru: '`planBeats` резолвит `source.index` сброса против `before`, но очередь тактов передаёт дальше опубликованное состояние такта добора как базу такта сброса, а `useHandArrival` вставляет прилетевшую карту в середину веера — сброс на индексе на месте вставки или после неё летит из соседнего слота. Косметика, лучше отката веера, который был до передачи базы между тактами; честный фикс меняет, как `planBeats` и очередь делят резолвинг индексов. — ОТВЕТ ВЛАДЕЛЬЦА встречным вопросом: это какой-то крайний тест на анимации? Зачем совмещать добор и сброс, когда это вообще встречается? Пока игровой момент не назван, у записи нет предмета.',
      en: '`planBeats` resolves the discard’s `source.index` against `before`, but the beat queue now chains the draw beat’s published state forward as the discard beat’s base, and `useHandArrival` inserts the arriving card into the middle of the fan — a discard at or after that index flies from the neighbouring slot. Cosmetic, better than the whole-fan rollback that preceded chaining bases between beats; the honest fix changes how `planBeats` and the queue split index resolution. — THE OWNER answered with a question of his own: is this some edge test for animations? Why combine a draw and a discard, and when does that even happen? Until the moment in a game is named, the entry has no subject.',
    },
    where: {
      ru: 'frontend: features/board-beats/planBeats.ts (source.index)',
      en: 'frontend: features/board-beats/planBeats.ts (source.index)',
    },
    status: 'open',
  },
  {
    what: {
      ru: 'Жест прицеливания на сенсорном экране не решён',
      en: 'An aim gesture on a touchscreen is undecided',
    },
    problem: {
      ru: 'Стрелка (#99) целится курсором: `useArrow` следит за `mousemove`, а вся стадия жеста — `_useBoardStaging` — устроена вокруг мыши, вплоть до порога клик/drag в `Hand`, которым продолжается полёт в центр. Ни здесь, ни где-либо ещё в проекте touch-эквивалент не решён — на сенсорном экране карту нечем даже поставить в центр стола, постановка ломается раньше прицела. — ОТВЕТ ВЛАДЕЛЬЦА: решается отдельным заходом. Направление: удержание пальца указывает, куда прилетит, и срабатывает на выбранном объекте, когда палец отпущен.',
      en: 'The arrow (#99) aims off the cursor: `useArrow` tracks `mousemove`, and the whole staging gesture — `_useBoardStaging` — is built around a mouse, down to the click/drag threshold in `Hand` that the flight to the centre continues from. No touch equivalent is decided here or anywhere else in the project — on a touchscreen there is nothing to even stage a card with, so staging fails before aiming does. — OWNER: a separate pass. The direction: holding a finger down points at where the card will land, and it fires on the chosen object when the finger lifts.',
    },
    where: {
      ru: 'frontend: pages/board/[gameId]/_useBoardStaging.ts + ui: table/Hand',
      en: 'frontend: pages/board/[gameId]/_useBoardStaging.ts + ui: table/Hand',
    },
    status: 'open',
  },
  {
    what: {
      ru: 'С клавиатуры на борде не отбиться и не оплатить релиз — двери нет вообще',
      en: 'No keyboard answers an attack or pays for a release — there is no door at all',
    },
    problem: {
      ru: 'До #101 (Fix B) панель `PendingPrompt` рисовала для `defend` список карт настоящими кнопками — единственный не-мышиный ход на борде. Панель снята сознательно: она перекрывала ту самую атаку, о которой спрашивала, и спрашивала второй раз то, на что веер уже отвечает жестом. Веер и без того мышиный целиком — `Hand` рисует карты `interactive={false}`, слоты это `<div>` без `tabIndex` с одним `onMouseDown`, и собственный biome-ignore в `Hand.tsx` говорит прямо: «pointer-only … no keyboard affordance implied». После ревью всей ветки (#101, Fix C) известно, что дыра шире: оплата релиза отвечается тоже ТОЛЬКО мышью — панель для `discardForRelease` снята по той же причине. Именно это сделало блокер того захода блокером: комбо-релиз держал веер в `pointer-events: none`, и цена становилась неоплачиваемой НИКАКИМ вводом. Мышиную половину починил Fix C; клавиатурной двери как не было, так и нет, поэтому у любого такого дедлока по-прежнему нет второго выхода. Закроет один общий ответ для `Hand` (фокусируемые слоты + Enter/пробел + стрелки?), а не костыль под каждый пендинг; возврат списка карт в панель воспроизводит и перекрытие центра, и второго спрашивающего. В #104 сюда добавился сброс по лимиту руки: `PendingPrompt` для `handLimit` снят, потому что он накрывает собираемую сетку и спрашивает второй раз то, что уже спрашивает веер. У этого случая нет собственного дедлайна, поэтому зависший мышиный выбор останавливает матч всем. — ЗАКРЫТО ОТВЕТОМ ВЛАДЕЛЬЦА: игра изначально сделана под мышь, клавиатуры в планах не было. Возвращать островок ради одной защиты не нужно; клавиатура прорабатывается отдельным заходом, если понадобится.',
      en: 'Until #101 (Fix B) the `PendingPrompt` panel drew a `defend` as a list of real buttons — the one non-mouse move on the board. The panel was removed deliberately: it covered the very attack it was asking about, and asked a second time what the fan already answers by gesture. The fan is mouse-only to begin with — `Hand` renders cards `interactive={false}`, its slots are `<div>`s with no `tabIndex` and a single `onMouseDown`, and its own biome-ignore says it outright: "pointer-only … no keyboard affordance implied". Since the whole-branch review (#101, Fix C) the gap is known to be wider: a release’s cost is mouse-only too — the panel is suppressed for `discardForRelease` for the same reason. That is what made that round’s blocker a blocker: a combo release held the fan at `pointer-events: none`, and the cost became unpayable by ANY input. Fix C repaired the mouse half; the keyboard door never existed, so any such deadlock still has no second way out. Closed by one answer for `Hand` as a whole (focusable slots + Enter/Space + arrows?), not a per-pending patch; putting the card list back in the panel reproduces both the occlusion and the second asker. #104 adds hand-limit discard to the same gap: `PendingPrompt` is suppressed for `handLimit` because it covers the grid being assembled and asks a second time what the fan already asks. This pending has no deadline of its own, so a stalled mouse-only choice stops the match for everyone. — CLOSED BY THE OWNER: the game was made for the mouse from the start and a keyboard was never planned. Bringing the island back for one defence is not the answer; a keyboard is a separate pass if it is ever wanted.',
    },
    where: {
      ru: 'ui: table/Hand + frontend: pages/board/[gameId]/_Board.tsx (PendingPrompt), _useBoardStaging.ts (onCostPick), _useHandLimit.tsx',
      en: 'ui: table/Hand + frontend: pages/board/[gameId]/_Board.tsx (PendingPrompt), _useBoardStaging.ts (onCostPick), _useHandLimit.tsx',
    },
    status: 'ok',
  },
  {
    what: {
      ru: 'Ответ движка обгонял свою же защиту в полёте — карта возвращалась в веер на весь такт',
      en: 'The engine answered before our own defence had landed — the card returned to the fan for the beat',
    },
    problem: {
      ru: 'ЗАКРЫТО в #101, Fix D round 4. `_useDefenseStaging.commitAndFly` шлёт `onResolve` синхронно и только потом везёт карту веер→прикрытие, а ответ `covered` приезжает ВНУТРИ полёта (у хоста движок локальный; клиенту хватит круга короче одного полёта). Тот коммит рендерился с ещё пустым `beats.shadow`, то есть `state === live`: пендинга нет, карты в руке нет — и пассивная догонялка чистила `staged`, считая розыгрыш принятым. Следующий коммит рисовал тень (`base`), где карта снова в руке и прятать её уже нечем, — карта возвращалась в веер и лежала там весь такт рядом с собой же в центре. Второй артефакт того же коммита: такт читал хендофф с пустым `el`, принимал это за реджойн и вёз карту из веера второй раз (закрыто в round 3). Починка: догонялка больше не верит проекции, пока её собственный носитель не отпустил карту (`landed`), и — раз staged теперь доживает до `release()` такта — такт вообще не трогает свою защиту (`!(mine && handoff)`), так что вопрос «успел ли появиться узел» просто не задаётся. Каждый выход обоих полётов отчитывается `setLanded(true)` в `finally`, поэтому веер не может остаться с дыркой, если полёт отменили.',
      en: 'CLOSED in #101, Fix D round 4. `_useDefenseStaging.commitAndFly` sends `onResolve` synchronously and only then carries the card fan→cover, and the `covered` answer arrives INSIDE that flight (the host’s engine is local; a client needs only a round trip shorter than one flight). That commit rendered with `beats.shadow` still null, so `state === live`: no pending, the card gone from hand — and the passive catch-up cleared `staged`, reading the play as accepted. The next commit drew the shadow (`base`), where the card is back in hand with nothing left to hide it, so the card returned to the fan and lay there for the whole beat beside itself at the centre. The same commit’s second artifact: the beat read a handoff with a null `el`, took it for a rejoin, and flew the card in from the fan a second time (closed in round 3). The fix: the catch-up no longer believes the projection until its own carrier has let go (`landed`), and — since `staged` now survives to the beat’s `release()` — the beat leaves our own defence alone entirely (`!(mine && handoff)`), so the question of whether its node exists yet is never asked. Both flights report `setLanded(true)` from a `finally` on every exit, so a cancelled flight cannot leave the fan with a hole in it.',
    },
    where: {
      ru: 'frontend: pages/board/[gameId]/_useDefenseStaging.tsx (catch-up, commitAndFly), _Board.tsx (handoff layout effect), features/board-beats/defenseBeat.tsx (runCovered)',
      en: 'frontend: pages/board/[gameId]/_useDefenseStaging.tsx (catch-up, commitAndFly), _Board.tsx (handoff layout effect), features/board-beats/defenseBeat.tsx (runCovered)',
    },
    status: 'ok',
  },
  {
    what: {
      ru: 'Такт летит из bounding-box наклонённого слота веера — это I6, только наоборот',
      en: 'A beat flies from a tilted fan slot’s bounding box — that is I6, backwards',
    },
    problem: {
      ru: '`comboBeat.foldIn` и `defenseBeat.runCovered` берут исходную коробку карты как `rectOf(anchors.handSlotAt(i))` — сырой `getBoundingClientRect()` слота. Слот повёрнут (`slotPlacement` даёт каждому свой угол), так что это коробка ВОКРУГ наклонённой карты, шире и выше её самой: ровно то, от чего предостерегает I6. Соседняя нога той же цепочки уже делает правильно — `anchors.seatBox` кладёт `cardBoxIn(rect, CARD_W)`, и `useHandArrival.boxOf` тоже, со своим объяснением почему. Первый кадр полёта стартует не с той коробки, тем заметнее, чем сильнее отклонён слот. Кандидатов на починку два, и они дают РАЗНЫЕ ответы: `cardBoxIn(slotRect, CARD_W)` (дёшево, но считает от текущего прямоугольника, включая ховер-подъём) или `slotBox(i, total)` из `_useBoardStaging.ts` (честно, от `slotPlacement`, без DOM) — но `total` это длина ВЫРИСОВАННОГО веера, которой у такта нет: он работает против `base`, а веер отфильтрован тем, что стоит на столе (ровно та рассинхронизация, которую Fix D round 2 закрыл на соседнем шве). Выбор между ними — решение о геометрии, которое нечем проверить: jsdom обе ветки не различает. — ЗАКРЫТО ОТВЕТОМ ВЛАДЕЛЬЦА: карта с края веера не может стартовать наклонённой, потому что под ховером она ВЫРАВНИВАЕТСЯ. Запись упустила часть движения и спрашивала про то, чего в ней нет.',
      en: '`comboBeat.foldIn` and `defenseBeat.runCovered` take a card’s source box as `rectOf(anchors.handSlotAt(i))` — a raw `getBoundingClientRect()` of the slot. The slot is rotated (`slotPlacement` gives each its own angle), so that is the box AROUND the tilted card, wider and taller than the card itself: exactly what I6 warns against. The sibling leg of the same chain already does it right — `anchors.seatBox` applies `cardBoxIn(rect, CARD_W)`, and so does `useHandArrival.boxOf`, with its own note on why. The flight’s first frame starts from the wrong box, the more visibly the further the slot is deflected. Two candidate fixes, and they give DIFFERENT answers: `cardBoxIn(slotRect, CARD_W)` (cheap, but reads the current rect, hover lift included) or `slotBox(i, total)` from `_useBoardStaging.ts` (honest, derived from `slotPlacement`, no DOM) — but `total` is the length of the RENDERED fan, which a beat does not have: it runs against `base`, and the fan is filtered by whatever stands on the table (the very divergence Fix D round 2 closed at the neighbouring seam). Choosing between them is a geometry decision nothing here can check: jsdom cannot tell the two apart. — CLOSED BY THE OWNER: a card at the edge of the fan cannot take off tilted, because hovering STRAIGHTENS it. The entry had dropped half of the movement and then asked about the hole.',
    },
    where: {
      ru: 'frontend: features/board-beats/comboBeat.tsx (foldIn), defenseBeat.tsx (runCovered) + entities/game/board/anchors.ts',
      en: 'frontend: features/board-beats/comboBeat.tsx (foldIn), defenseBeat.tsx (runCovered) + entities/game/board/anchors.ts',
    },
    status: 'ok',
  },
  {
    what: {
      ru: 'Клик в веере может начать вторую игру, пока первая ещё в пути',
      en: 'A fan click can start a second play while the first is still in flight',
    },
    problem: {
      ru: '`onHandPlay` отказывает любому ВЫТЯГИВАНИЮ, пока что-то стоит на столе; у клика такого правила нет. `_useBoardStaging.onCardClick` возвращает `false`, когда стоящая игра — не шаг «выбери партнёра» и не шаг оплаты, и клик уходит в обычный клик-жест, который разыграет любую карту из `state.playable` без цели. А `state.playable` в этот момент ещё старый: проекция отстаёт на круг. Движок вторую игру почти наверняка отклонит, и карта вернётся в веер тихо — но игрок увидит, как карта улетает и прилетает обратно без объяснения. Найдено в Fix D round 2 рядом с off-by-one на том же шве (клик отдавал индекс отрисованного веера в массив всей руки, и с релизом на столе клик по запасной карте переигрывал сам релиз); индекс починен, это независимая вторая половина. Закроет одна строка: `onCardClick` должен ГЛОТАТЬ клик, пока что-то стоит (`return true` вместо `return false`), — то же правило, что у `onHandPlay`, и согласуется с тем, что `stateAt` в этот момент ничего в веере не подсвечивает. Не сделано в Fix D: смена поведения на пути, общем для вытягивания и клика, а проверить её на живом столе нечем. — ОТВЕТ ВЛАДЕЛЬЦА: розыгрыша кликом в игре нет, играют перетаскиванием. По описанию не воспроизводится, в том числе в плейграунде. Похоже на неполноту переноса на борд, а не на игровую ситуацию.',
      en: '`onHandPlay` refuses any PULL while something stands on the table; a click has no such rule. `_useBoardStaging.onCardClick` returns `false` when the standing play is neither a partner pick nor a cost step, and the click goes on to the plain click gesture, which plays any card in `state.playable` that needs no target. And `state.playable` is stale at that moment: the projection is a round trip behind. The engine will almost certainly reject the second play and the card returns to the fan silently — but the player watches a card fly out and come back with no explanation. Found in Fix D round 2 beside an off-by-one at the same seam (the click handed a rendered-fan index to the whole-hand array, so with a release standing a click on the spare re-played the release itself); the index is fixed, this is the independent other half. Closed by one line: `onCardClick` should SWALLOW the click while anything is staged (`return true` instead of `return false`) — the same rule `onHandPlay` keeps, and consistent with `stateAt` lighting nothing in the fan at that moment. Not done in Fix D: it changes behaviour on a path shared by pulls and clicks, and there is nothing here to check it on a live table. — OWNER: there is no click-to-play in the game, cards are played by dragging. It does not reproduce as described, in the playground either. It looks like an incomplete port to the board rather than a situation in the game.',
    },
    where: {
      ru: 'frontend: pages/board/[gameId]/_useBoardStaging.ts (onCardClick), _useBoardInteractions.ts',
      en: 'frontend: pages/board/[gameId]/_useBoardStaging.ts (onCardClick), _useBoardInteractions.ts',
    },
    status: 'open',
  },
  {
    what: {
      ru: 'Превью веера снова закрывает центр во время оплаты, и нажатие сквозь него отменяет релиз',
      en: 'The fan’s preview covers the centre again during the cost step, and a press through it cancels the release',
    },
    problem: {
      ru: '#100 увёл веер в `pointer-events: none`, пока пара стоит сложенной в центре: ховер-превью `Hand` поднимается ровно туда и закрывает её. #101 (Fix C) заставил гвард УСТУПАТЬ на шаге оплаты релиза — веер единственный, кто может назвать цену (панель для `discardForRelease` снята, клавиатуры у веера нет), так что инертный веер делал цену неоплачиваемой никаким вводом. Уступка верна, дедлок хуже перекрытия. Вторая половина размена: на всю фазу оплаты превью снова стоит над парой, а у `.zoom` стоит `pointer-events: none` — нажатие в превью проваливается на то, что под ним, не находит `[data-hand-slot]`, и слушатель промаха на корне стола читает его как «передумал» и отменяет релиз. Попытка ПРОЧИТАТЬ карту отменяет розыгрыш. Исключить превью из промаха нельзя, пока оно не цель события; сделать его целью значит отдать ему ховер, который его поднял. Закроет решение в `Hand`: превью, которое не поднимается над занятым центром (проп «где нельзя»), либо флаг на время показа, читаемый слушателем промаха. — ЗАКРЫТО ОТВЕТОМ ВЛАДЕЛЬЦА: случая не существует. Превью вызывается наведением мыши, поэтому нельзя одновременно держать превью и ткнуть в область, которую оно закрывает; уходит оно сразу, как мышь ушла, и это уже предусмотрено.',
      en: '#100 put the fan at `pointer-events: none` while a pair stands folded at the centre: `Hand`’s hover preview rises into exactly that space and covers it. #101 (Fix C) made the guard YIELD during a release’s cost step — the fan is the only picker there is (the panel is suppressed for `discardForRelease`, and the fan has no keyboard path), so an inert fan made the cost unpayable by any input. The yield is right; a deadlock is worse than an occlusion. The other half of the trade: for the whole cost step the preview stands over the pair again, and `.zoom` is `pointer-events: none` — a press landing on the preview falls THROUGH to whatever is beneath, matches no `[data-hand-slot]`, and the table-root miss listener reads it as "changed my mind" and cancels the release. Trying to READ a card can undo the play. The preview cannot be exempted while it is not an event target, and making it one hands it the hover that raised it. Closed by a decision in `Hand`: a preview that does not rise over an occupied centre (a "where it must not go" prop), or a flag it raises while shown that the miss listener reads. — CLOSED BY THE OWNER: the case does not exist. A preview is summoned by hovering, so it cannot be held while you click what it covers; it leaves the moment the mouse does, which is already the behaviour.',
    },
    where: {
      ru: 'ui: table/Hand (zoom) + frontend: pages/board/[gameId]/_Board.tsx (handWrap, cost mousedown)',
      en: 'ui: table/Hand (zoom) + frontend: pages/board/[gameId]/_Board.tsx (handWrap, cost mousedown)',
    },
    status: 'ok',
  },
  {
    what: {
      ru: 'Граница матча заведена на ключ, который не меняется между матчами',
      en: 'The match boundary hangs on a key that never changes between matches',
    },
    problem: {
      ru: '`<Board>` не перемонтируется на реванш (`_layout.tsx` не даёт ему `key`), поэтому и `useBeats`, и оба жестовых хука держат сброс на границе матча: стоящая в центре карта, оплаченная цена, стрелка, флаер, припаркованный `useHandArrival`. Сбросы написаны и покрыты тестами, но ключ матч не различает: в хук приходит `intro.gameId` → `session.gameId` → `useLobby.ts`’s `startGame`, где `const id = current.hostId` — peer id хоста, одинаковый для всех матчей одной комнаты. Второй `startGame` даёт тот же ключ, и эффект не срабатывает ни разу — так на этой ветке по состоянию на 2026-08-20. Это свойство ветки, а не закон: параллельно идёт работа над реваншем на месте (#19), где у каждого матча свой id, и там посылка уже неверна; при слиянии граница станет живой сама. Перед тем как опереться на любое из двух утверждений — перечитать `startGame` и то, что доезжает до `intro`. Сегодня латентно (реванша «на месте» нет, вход в матч перемонтирует борд) и опаснее обычного «забыли сбросить» тем, что сброс есть и на ревью читается как закрытый вопрос. Закроет идентификатор, чеканящийся в `startGame` (счётчик матчей или уже существующий `seed`) и уезжающий в payload `GAME_STARTING` рядом с `gameId` — маршрут не трогается, — проброшенный в оба хука И в `useBeats`: у очереди ровно тот же инертный ключ. — ЗАКРЫТО ОТВЕТОМ ВЛАДЕЛЬЦА: новый матч это НОВЫЙ МАТЧ, весь путь начинается заново с экрана лобби. Кнопки реванша нет и не планировалось, то есть граница матча внутри компонента заведена под выдуманную функцию.',
      en: '`<Board>` is not remounted for a rematch (`_layout.tsx` gives it no `key`), so `useBeats` and both gesture hooks keep a match-boundary reset: a card standing at the centre, a paid cost, the arrow, the flyer, a parked `useHandArrival`. The resets are written and covered by tests, but the key tells no two matches apart: what reaches the hook is `intro.gameId` → `session.gameId` → `useLobby.ts`’s `startGame`, where `const id = current.hostId` — the host’s peer id, identical for every match played in one room. A second `startGame` produces the same key and the effect never fires — on this branch, as of 2026-08-20. That is a property of the branch, not a law: in-place rematch work is in flight (#19) where each match gets an id of its own, so the premise is already false there and the boundary becomes live of its own accord on merge. Re-read `startGame` and what reaches `intro` before leaning on either statement. Latent today (no in-place rematch exists; entering a match remounts the board) and worse than the ordinary "forgot to reset" because the reset IS there and reads as a closed question in review. Closed by an id minted in `startGame` (a match counter, or the dealer `seed` that already exists) carried in the `GAME_STARTING` payload beside `gameId` — the route stays untouched — and threaded into both hooks AND `useBeats`: the queue hangs on the very same inert key. — CLOSED BY THE OWNER: a new match is a NEW MATCH, the whole path starts again from the lobby. There is no rematch button and none was planned, so the match boundary inside the component was built for an invented feature.',
    },
    where: {
      ru: 'frontend: pages/board/[gameId]/_Board.tsx (matchKey), _useBoardStaging.ts, _useDefenseStaging.tsx, features/board-beats/useBeats.ts + network/useLobby.ts (startGame)',
      en: 'frontend: pages/board/[gameId]/_Board.tsx (matchKey), _useBoardStaging.ts, _useDefenseStaging.tsx, features/board-beats/useBeats.ts + network/useLobby.ts (startGame)',
    },
    status: 'ok',
  },
  {
    what: {
      ru: 'Кому Rollback вернул атаку — выводится, а не читается',
      en: 'Who Rollback returns an attack to — derived, not read',
    },
    problem: {
      ru: '`attacks.ts:245-252` кладёт атакующую карту в руку прямой записью и не шлёт ни одного события — `handTransfer` объявлен в `events.ts:37` и здесь не используется. Такт (`defenseBeat.runCovered`) выводит получателя: защитник, если в этой же резолюции есть `discarded(support-sudo, defenceSpent)`, иначе атакующий. Вывод покрыт тестами (`planBeats.test.ts`, `defenseBeat.test.tsx`), но ломается молча при переименовании причины сброса или втором sudo-способном support в каталоге. — ОТВЕТ ВЛАДЕЛЬЦА: не на моей стороне, а как запись это негодно — «кто-то что-то переименует, и логика сломается» верно для чего угодно; в том и смысл архитектуры, что страдающий хернёй ломает игру себе. Аргумент снят, остаётся один проверяемый факт: движок не шлёт объявленный handTransfer, поэтому получателя такт выводит.',
      en: '`attacks.ts:245-252` puts the attack card into a hand by a direct write and sends no event for it — `handTransfer` is declared at `events.ts:37` and unused here. The beat (`defenseBeat.runCovered`) derives the recipient: the defender if this same resolution carries a `discarded(support-sudo, defenceSpent)`, else the attacker. The derivation is covered by tests (`planBeats.test.ts`, `defenseBeat.test.tsx`), but breaks silently if the discard reason is renamed or a second sudo-capable support joins the catalogue. — OWNER: not on my side, and as an entry it is no good — "someone renames something and the logic breaks" is true of anything; that is what architecture is for. The argument is dropped; one checkable fact remains: the engine never sends the handTransfer it declares, so the beat derives the recipient.',
    },
    where: {
      ru: 'packages/engine: fake/attacks.ts (setHand) + frontend: features/board-beats/planBeats.ts, defenseBeat.tsx',
      en: 'packages/engine: fake/attacks.ts (setHand) + frontend: features/board-beats/planBeats.ts, defenseBeat.tsx',
    },
    status: 'rework',
  },
  {
    what: {
      ru: 'Отмена пары возвращается в одну щель веера, а не в две',
      en: 'A cancelled pair returns through one fan gap, not two',
    },
    problem: {
      ru: '`cancel()` возвращает обе половины сложенной пары одним `useHandArrival.arrive` на индекс, где опора стояла при вытягивании, — общая щель на двоих. Так же устроен `cancelStage` в ComboStory, откуда это портировано без изменений. Принятое поведение сцены-источника, не самостоятельная борд-придумка; пересмотреть стоит, только если возврат станет плохо читаться на живом борде. — ЗАКРЫТО ОТВЕТОМ ВЛАДЕЛЬЦА: кейса отмены сложенной пары нет, в момент, когда взята вторая карта для комбо, пара разыгрывается. Парная вставка в руку как механика проверена на странице Card to Hand и работает: веер открывает по щели на карту, каждая летит в свой слот.',
      en: "`cancel()` returns both halves of a folded pair through one `useHandArrival.arrive` call, at the index the support stood at when it was pulled — one shared gap for both. ComboStory's own `cancelStage`, which this is ported from unchanged, does the same. The source scene's own accepted behaviour, not a board-specific invention; worth revisiting only if the return reads badly on the live board. — CLOSED BY THE OWNER: there is no cancel-a-folded-pair case; the moment the second card is taken for a combo, the pair is played. Pair insertion into the hand as a mechanic was checked on the Card to Hand page and works: the fan opens one gap per card and each flies into its own slot.",
    },
    where: {
      ru: 'frontend: pages/board/[gameId]/_useBoardStaging.ts (cancel)',
      en: 'frontend: pages/board/[gameId]/_useBoardStaging.ts (cancel)',
    },
    status: 'ok',
  },
  {
    what: {
      ru: 'Один sync-флаш: тень публикуется всем, кроме того, кто сам отвечает',
      en: 'One sync flush: the shadow is published to everyone except the peer who answers',
    },
    problem: {
      ru: 'Когда бросок и ответ приезжают ОДНИМ батчем (в звезде — норма для всех, кто не атакующий и не защищающийся), `planBeats` ведёт `openAttack` по ходу разбора, как уже вёл `piles`, и такт `covered` строится. Вторая половина: атака должна быть на экране, пока над ней держат защиту, а `runAttack` снимает флаер сразу после фолда, рассчитывая на статичный рендер центра — которого в таком батче нет (`base` старше батча). Поэтому `runAttack` публикует тень с `pending: defend`. Не публикует, когда отвечать должны МЫ: `options` тут не вывести (движок редактирует их для всех, кроме владельца), а пустой список сказал бы нашему борду «с тебя защита» без единой легальной карты. Безопасность этой ветки — вывод, а не факт: пир, который ответил, обязан был увидеть атаку раньше. Fix D закрыл второй угол — свой собственный бросок: ветка атакующего выходила из такта раньше публикации, и его атака мигала так же; публикация вынесена в общий шаг и зовётся из обеих веток, а поверх любого уже стоящего пендинга теперь отказывает, а не перезаписывает. Остаётся угол защищающегося и выдуманные часы: тень публикуется с `openedAt: 0, deadline: 0`, и `deriveDock` показывает каждому смотрящему кольцо `hold` с `0s` на длину такта. Не класть эти поля вовсе нельзя: `engineContract.test-d.ts` держит union пендингов кита структурно ТОЧНО равным `PendingView` движка, где часы обязательны. Закроет поле/событие, из которого `options` выводится на месте, или отдельная не-`pending` форма «на столе лежит атака», которую центр умеет рисовать, а `answering` и док не читают — она же снимает и `0s`-кольцо. — ОТВЕТ ВЛАДЕЛЬЦА: когда кто-то кого-то атакует, разыгранные карты в центре видны ВСЕМ, это публичное действие; защищаться от того, чего не видишь, нечем. Значит ветка «защищающемуся не публикуем» неверна по существу: скрытие возникло не по замыслу, а из формы — тень публиковалась как ПЕНДИНГ, а у пендинга есть список легальных карт, который движок режет под каждого зрителя. Закрывает разделение двух смыслов: «на столе лежит карта» — публично и одинаково всем, читает только рендер центра; «с тебя решение» — личное, с опциями и часами, читают док и жесты. Вместе с этим уходят и выдуманные openedAt/deadline.',
      en: 'When a throw and its answer arrive in ONE batch — the norm in a star for every peer who is neither attacker nor defender — `planBeats` now tracks `openAttack` through the walk, the way it already tracked `piles`, and the `covered` beat is built. The other half: the attack has to be ON SCREEN while the cover is held over it, and `runAttack` drops its carrier right after the fold, counting on the centre’s static render — which such a batch does not have (`base` predates it). So `runAttack` publishes a `pending: defend` shadow. It does not publish when the answer is OURS: `options` cannot be derived here (the engine redacts them for everyone but the owner), and an empty list would tell our own board a defence is owed with no legal card to give it. That branch’s safety is an inference rather than a fact from the events: a peer who answered must have seen the attack earlier. Fix D closed a second corner — our OWN throw: the attacker’s arm left the beat before the publish, so their own attack blinked out the same way; the publish moved into a shared step called from both arms, and it now declines over any pending already standing rather than replacing it. Still open: the defender’s corner, and a fabricated clock — the shadow publishes `openedAt: 0, deadline: 0`, so `deriveDock` shows every watching peer a `hold` ring reading `0s` for the length of the beat. Omitting the two fields is not writable: `engineContract.test-d.ts` holds the kit’s pending union structurally EXACT against the engine’s `PendingView`, where a defend’s clock is required. Closed by a field/event that makes `options` derivable on the spot, or by a separate non-`pending` "an attack is lying on the table" shape the centre can draw and neither `answering` nor the dock reads — which removes the `0s` ring too. — OWNER: when someone attacks someone, the cards played to the centre are seen by EVERYONE, it is a public action; there is nothing to defend with against what you cannot see. So the branch that withholds the shadow from the defender is wrong on the merits: the hiding came from the shape rather than from intent — the shadow was published as a PENDING, and a pending carries the legal-card list the engine redacts per viewer. What closes it is splitting the two meanings: a card lies on the table — public, identical for all, read only by the centre; a decision is owed by you — private, with options and a clock, read by the dock and the gestures. The invented openedAt/deadline go with it.',
    },
    where: {
      ru: 'frontend: features/board-beats/planBeats.ts (openAttack), comboBeat.tsx (runAttack)',
      en: 'frontend: features/board-beats/planBeats.ts (openAttack), comboBeat.tsx (runAttack)',
    },
    status: 'rework',
  },
  {
    what: {
      ru: 'Атака на борде прилетает без наклона — его даёт поза покоя',
      en: 'On the board an attack lands untilted — the rest pose supplies the tilt',
    },
    problem: {
      ru: 'В сцене атака летит `playToCenter` с `rotate: ATTACK_POSE.rot` (480ms) и приземляется уже наклонённой. На борде тот же прилёт делает `comboBeat.foldIn` — `foldIntoPair`, 620ms, только translate+scale: пресет знает позу половины ВНУТРИ пары, но не поворот карты на столе, а один рантаймер обслуживает и одиночную атаку, и пару с судо. Поэтому наклон даёт поза покоя: pending-атака рисуется во внутреннем `.pose` при `restTransform(ATTACK_POSE)` (#101, Fix A) — она же то, ОТ чего стартует выход (`useDiscardExit.pose`), без неё карта дёргалась с 0° на −4° на первом кадре ухода. Покой совпал, движение — нет: в сцене доворот едет по дуге полёта, на борде появляется мгновенно. Закроет `rotate`/`pose` у `foldIntoPair` для карты (не для половины) или отдельный шаг «прилёт на стол в позе» со своей строкой в reference.md. — ОТВЕТ ВЛАДЕЛЬЦА: на нашей стороне уже решено, надо адаптировать. В словаре есть шаг landInPose (наклон едет вместе с картой и в неё же приземляется), инвариант I11 записан. Осталось: comboBeat.foldIn зовёт landInPose для ОДИНОЧНОЙ атаки, парный путь остаётся на foldIntoPair, и ATTACK_POSE сводится к одному объявлению вместо двух.',
      en: 'In the scene an attack flies `playToCenter` with `rotate: ATTACK_POSE.rot` (480ms) and lands already tilted. On the board the same arrival is `comboBeat.foldIn` — `foldIntoPair`, 620ms, translate+scale only: the preset knows a half’s pose INSIDE a pair, not a card’s rotation on the table, and one runner serves a lone attack and a sudo pair alike. So the tilt comes from the rest pose instead: the pending attack renders in an inner `.pose` at `restTransform(ATTACK_POSE)` (#101, Fix A) — which is also what the exit starts from (`useDiscardExit.pose`), and without it the card popped from 0° to −4° on the exit’s first frame. The rest matches now, the movement does not: in the scene the turn rides the flight arc, on the board it appears instantly. Closed by a `rotate`/`pose` param on `foldIntoPair` for the CARD (not the half), or a step of its own for "landing on the table in a pose", with its row in reference.md. — OWNER: decided on our side already, the board needs adapting. The vocabulary has the landInPose step (the tilt travels with the card and lands with it) and invariant I11 is written down. What is left: comboBeat.foldIn calls landInPose for the SINGLE attack, the pair path stays on foldIntoPair, and ATTACK_POSE collapses to one declaration instead of two.',
    },
    where: {
      ru: 'frontend: features/board-beats/comboBeat.tsx (foldIn), pages/board/[gameId]/_Board.tsx + playground: interactive/DefenseReleaseStory.tsx',
      en: 'frontend: features/board-beats/comboBeat.tsx (foldIn), pages/board/[gameId]/_Board.tsx + playground: interactive/DefenseReleaseStory.tsx',
    },
    status: 'rework',
  },
  {
    what: {
      ru: 'Фолд карты и судо в пару написан четыре раза, не как модуль',
      en: 'The card-and-sudo fold into a pair is written four times, not as a module',
    },
    problem: {
      ru: 'Один и тот же ход — измерить обе половины, покрасить входные позы enterPose, nextFrames, затем параллельный foldIntoPair на каждую половину — существует отдельным кодом в DefenseReleaseStory.tsx (mergeIntoPair), comboBeat.tsx (foldIn) и _useDefenseStaging.tsx (onCardClick), все три на флаере с CardPair как content, и ещё раз в _useBoardStaging.ts — тем же ходом, но на персистентном узле вместо флаера (оттого и без вспышки в позе покоя, которую флаерная форма даёт на первый кадр-другой, пока raise дожидается nextFrames). Правка тайминга или порядка кадров в одной копии не долетит до трёх остальных сама. — СДЕЛАНО НА НАШЕЙ СТОРОНЕ: жест собран шагом usePairFold() и обе плейграундные копии переведены на него — DefenseRelease (защита и своё судо) и Combo (опора и партнёр, вместе с её персистентным узлом). Шаг закрыл и слепое пятно флаерной формы: пара монтируется невидимой и открывается в тот же тик, когда половинам проставлены входные позы, поэтому кадра «уже сложена» больше нет. Осталось три копии на борде — они заменяются вызовом.',
      en: 'The same move — measure both halves, paint their entry poses with enterPose, nextFrames, then a parallel foldIntoPair per half — exists as separate code in DefenseReleaseStory.tsx (mergeIntoPair), comboBeat.tsx (foldIn) and _useDefenseStaging.tsx (onCardClick), all three on a flyer carrying a CardPair as content, and once more in _useBoardStaging.ts — the same move, but on a persistent node instead of a flyer (which is also why it skips the flash of the rest pose the flyer form shows for a frame or two while raise awaits nextFrames). A timing or frame-order fix in one copy will not reach the other three on its own. — DONE ON OUR SIDE: the gesture is packed into the usePairFold() step and both playground copies now call it — DefenseRelease (a defence and your own sudo) and Combo (the source and its partner, together with its persistent node). The step also closed the flyer form blind spot: the pair mounts invisible and is revealed in the same tick its halves get their entry poses, so the frame showing it already folded is gone. Three copies remain on the board, each replaceable by the call.',
    },
    where: {
      ru: 'frontend: pages/board/[gameId]/_useBoardStaging.ts, _useDefenseStaging.tsx, features/board-beats/comboBeat.tsx + playground: interactive/DefenseReleaseStory.tsx',
      en: 'frontend: pages/board/[gameId]/_useBoardStaging.ts, _useDefenseStaging.tsx, features/board-beats/comboBeat.tsx + playground: interactive/DefenseReleaseStory.tsx',
    },
    status: 'rework',
  },
  {
    what: {
      ru: 'Строка-подсказка под центром стола написана дважды',
      en: 'The ask line under the centre of the table is written twice',
    },
    problem: {
      ru: 'Всегда смонтированная плашка «чего стол ждёт», проявляющаяся и гаснущая переходом (opacity + сдвиг 132px → 146px за 260ms --ease-out), написана отдельным CSS два раза: .ask в DefenseReleaseStory.module.css (одобренный источник) и .ask в _Board.module.css — борд получил её в #101 (Fix B) вместе с отменой панели на defend. Значения совпадают до пикселя только потому, что вторая копия процитирована с первой. Это переход CSS, а не play(), поэтому словарь animations/ его и не покрывал: там полёты по координатам, а не состояние смонтированного элемента, — модуля под «поверхность, которая проявляется на месте» в проекте нет вовсе. Отдельно разошлось prefers-reduced-motion: у копии борда переход погашен, у копии сцены нет. Закроет либо класс-утилита рядом с токенами, либо (если таких поверхностей наберётся больше одной) маленький шаг в apps/ui со своей строкой в reference.md — но раньше кода стоит решение, считается ли поверхность на месте частью словаря «полётов». — ОТВЕТ ВЛАДЕЛЬЦА: словарь полётов написан для КАРТ, а не для текстов; на узкие экраны игра сама по себе не рассчитана, так что ширина не предмет. СДЕЛАНО НА НАШЕЙ СТОРОНЕ: строка стала одним компонентом кита — AskLine (table/TableCentre/AskLine.tsx), со своей страницей Ask line в блоках; висит она не на своей высоте, а на высоте центра (CENTRE_TOP плюс смещение), и 14px между скрытым и видимым положением это всё её движение. Сцена DefenseRelease переведена на компонент, её копия CSS удалена. Осталась копия борда.',
      en: 'The always-mounted "what the table is waiting for" line, fading in and out by transition (opacity + a 132px → 146px shift over 260ms --ease-out), is written as separate CSS twice: `.ask` in DefenseReleaseStory.module.css (the approved source) and `.ask` in _Board.module.css — the board got it in #101 (Fix B) along with dropping the panel for a defend. The values match to the pixel only because the second copy was quoted off the first. It is a CSS transition rather than a play(), which is why the animations/ vocabulary never covered it: that vocabulary is flights by coordinates, not the state of a mounted element — there is no module for "a surface that appears in place" at all. prefers-reduced-motion has already diverged too: the board copy kills the transition, the scene copy does not. What closes it is either a utility class beside the tokens or, if more than one such surface turns up, a small step in apps/ui with its own row in reference.md — but ahead of the code sits the decision whether an in-place surface belongs to a vocabulary of flights. — OWNER: the flight vocabulary is written for CARDS, not for text; the game is not built for narrow screens in the first place, so the width is not the subject. DONE ON OUR SIDE: the line is now one kit component — AskLine (table/TableCentre/AskLine.tsx) with its own Ask line page in the blocks; it holds no height of its own but hangs off the centre (CENTRE_TOP plus an offset), and the 14px between hidden and shown is its whole movement. The DefenseRelease scene now calls the component and its CSS copy is gone. The board copy remains.',
    },
    where: {
      ru: 'frontend: pages/board/[gameId]/_Board.module.css (.ask) + playground: interactive/DefenseReleaseStory.module.css (.ask)',
      en: 'frontend: pages/board/[gameId]/_Board.module.css (.ask) + playground: interactive/DefenseReleaseStory.module.css (.ask)',
    },
    status: 'rework',
  },
  {
    what: {
      ru: 'Событийная карта, ушедшая домой, объявляется `discarded`',
      en: 'An event card banked home is announced as `discarded`',
    },
    problem: {
      ru: '`bankToDiscard` (`packages/engine/src/fake/core.ts`) уводит карту с полем `event` обратно в колоду событий, но `discarded`, которым это отчитывается, называет пунктом назначения сброс всегда, а стоящая на столе карта несёт обычный `release-<slot>` id (нарочно, чтобы читаться как рядовой релиз) — доске нечем отличить один случай от другого. Не новое и не только про 503: `discardBeat` несёт тот же слепой пробел для любой событийной карты. #102-й `neutralized`-план сацерифайса утверждает один такой сброс как обычный, и сожжённый `ai-release` летит в кучу сброса, где никогда по-настоящему не приземляется. Закроет пункт назначения на `discarded`, или отдельное событие для «событийная карта вернулась в свою колоду». — ЗАКРЫТО (#106): `packages/engine/src/view.ts`’s `ReleasedView` несёт поле `event?: CardId` — events-deck id, которым карта уходит домой, если он у неё есть; `toBoardState.ts` кладёт его в `you.releaseEvent`/`opponents[].releaseEvent`, и `planBeats.ts` читает его через `releaseEventsOf` везде, где раньше пришлось бы гадать по `discarded`. `defenseBeat.tsx`’s `runNeutralized` (~:440) теперь посылает сожжённый в жертву событийный релиз `returnToDeck`, а не в кучу сброса.',
      en: '`bankToDiscard` (`packages/engine/src/fake/core.ts`) routes a card carrying an `event` field back to the events deck, but the `discarded` it reports names discard as the destination always, and the placed card carries the plain `release-<slot>` id on purpose (so it reads as an ordinary release) — the board has no way to tell the two apart. Pre-existing and general, not only about a 503: `discardBeat` carries the same blind spot for any event card. #102’s `neutralized` sacrifice plan claims one such discard as ordinary, and the burnt `ai-release` flies to the discard heap, where it never really lands. Closed by a destination on `discarded`, or an event of its own for “an event card went home”. — CLOSED (#106): `packages/engine/src/view.ts`’s `ReleasedView` carries an `event?: CardId` field — the events-deck id the card goes home as, when it has one; `toBoardState.ts` puts it on `you.releaseEvent`/`opponents[].releaseEvent`, and `planBeats.ts` reads it through `releaseEventsOf` everywhere it used to have to guess off `discarded`. `defenseBeat.tsx`’s `runNeutralized` (~:440) now sends a sacrificed events-deck release `returnToDeck` instead of to the discard heap.',
    },
    where: {
      ru: 'packages/engine: fake/core.ts (bankToDiscard), view.ts (ReleasedView.event) + frontend: entities/game/board/toBoardState.ts (releaseEvent), features/board-beats/planBeats.ts (releaseEventsOf), discardBeat.tsx, defenseBeat.tsx (runNeutralized)',
      en: 'packages/engine: fake/core.ts (bankToDiscard), view.ts (ReleasedView.event) + frontend: entities/game/board/toBoardState.ts (releaseEvent), features/board-beats/planBeats.ts (releaseEventsOf), discardBeat.tsx, defenseBeat.tsx (runNeutralized)',
    },
    status: 'ok',
  },
  {
    what: {
      ru: 'Пендинг без дедлайна останавливает партию',
      en: 'A pending with no deadline stalls the match',
    },
    problem: {
      ru: '`referee.ts:402` истекает по времени только `defend`-пендинги, а `:422` приостанавливает часы хода, пока открыт ЛЮБОЙ пендинг, кроме `discardForRelease` — тот исключён нарочно (`:421–427`) и форс-резолвится через `cancelRelease`, когда `turn.deadline` истекает, так что он не стоит в этом ряду. Подключённый игрок, который не отвечает на `neutralize503`, `handLimit`, `pickFromDiscard`, `requestCard`, `giveCard` или `crush`, замораживает партию для всех. Найдено при сборке #102 — правка общая для всех шести видов разом, а не для одного `neutralize503`, поэтому заведена отдельным issue (issue drafted, not yet filed).',
      en: '`referee.ts:402` expires only `defend` pendings, and `:422` suspends the turn clock while any pending is open, except `discardForRelease` — that one is deliberately excluded (`:421–427`) and force-resolves via `cancelRelease` once `turn.deadline` fires, so it does not belong on this list. A connected player who never answers a `neutralize503`, `handLimit`, `pickFromDiscard`, `requestCard`, `giveCard` or `crush` freezes the match for everyone. Found while building #102 — the fix belongs to all six kinds at once, not to one of them, so it is drafted as a separate issue (issue drafted, not yet filed).',
    },
    where: {
      ru: 'frontend: network/session/referee.ts',
      en: 'frontend: network/session/referee.ts',
    },
    status: 'open',
  },
  {
    what: {
      ru: 'Триггер AI сбанчен раньше, чем разрешится его собственный эффект',
      en: 'An AI trigger is banked before its own effect resolves',
    },
    problem: {
      ru: 'Правила отпускают триггер и эффект одним движением — оба стоят и уходят вместе (сценарный `resolveGeneric` у `AiCardsStory`, и собственный текст Bad Vibe в #106: «всё уходит разом: триггер в сброс, AI-карта в свою колоду»). Движок этого не делает: `fireTrigger` (`packages/engine/src/fake/triggers.ts`, ветка `trigger-ai`) заносит `discarded(trigger-ai)` сразу следом за `aiRevealed`, ДО того как `resolveAiEvent` вообще запускается, — а именно он решает, стоит ли AI-карта дальше и не открыт ли ею пендинг. К моменту, когда прогон доходит до вопроса «выдан ли прогноз», триггер уже в куче сброса, и когда прогноз остаётся висеть (`crush`, `neutralize503`-мимик, `handLimit`, `pickFromDiscard`), такт (`aiBeat.tsx`) вынужден оставить эффект стоять, а триггер отправить домой сразу — асимметрия, записанная в новом рецепте борда как чужая, движковая, а не решение такта. Та же форма, что у соседней находки про Security Bug — движок банкует карту в той же редукции, что поднимает пендинг, до того как стол успевает её показать.',
      en: 'The rules let go of the trigger and the effect in one movement — both stand and leave together (`AiCardsStory`’s own `resolveGeneric`, and #106’s own Bad Vibe text: “everything leaves at once: trigger to the discard, AI card back to its deck”). The engine does not: `fireTrigger` (`packages/engine/src/fake/triggers.ts`, the `trigger-ai` branch) files `discarded(trigger-ai)` immediately after `aiRevealed`, BEFORE `resolveAiEvent` ever runs — and it is `resolveAiEvent` that decides whether the AI card stands on and whether it opens a pending. By the time the walk reaches the question of whether a prompt is owed, the trigger is already in the discard heap, and on the four endings that leave a prompt standing (`crush`, `neutralize503`’s mimic, `handLimit`, `pickFromDiscard`) the beat (`aiBeat.tsx`) is forced to leave the effect standing while sending the trigger home at once — an asymmetry the new board recipe records as the engine’s own, not a choice this beat made. Same shape as the neighbouring Security Bug finding — the engine banks a card in the same reduction that raises the pending, before the table gets a chance to show it.',
    },
    where: {
      ru: 'packages/engine/src/fake/triggers.ts (fireTrigger, trigger-ai) + frontend: features/board-beats/aiBeat.tsx',
      en: 'packages/engine/src/fake/triggers.ts (fireTrigger, trigger-ai) + frontend: features/board-beats/aiBeat.tsx',
    },
    status: 'open',
  },
  {
    what: {
      ru: 'Четыре старых слота центра на борде дублируют `centre.ts`',
      en: 'The board’s four existing centre slots duplicate `centre.ts`',
    },
    problem: {
      ru: '`_Board.module.css:74-102` несёт `-92px` (`.stageSlot`), `+92px` (`.costSlot`), `-180px` (`.sudoSlot`) и `42%` как обычные CSS-литералы — те же числа, что `TableCentre/centre.ts` называет единственным источником и отдаёт через `centrePlaceStyle`. Три новых места AI (#106) — `cause`, `effect`, `picked` — уже читают его; четыре старых — нет, они старше самого файла-источника. Пока оба места держат одни и те же четыре числа порознь, правка одного — это правка, которую нужно не забыть повторить во втором, и ничто не роняет сборку, если её забыли. Закроет перевод четырёх слотов на `centrePlaceStyle`, читающий наборы release и defence вместо своих чисел — то же движение, каким в этой задаче уже пошли три новых слота AI; не сделано здесь, потому что слоты уже отгружены и приняты (Defense Release, #101), а регрессия в раскладке боя хуже записанного дублирования.',
      en: '`_Board.module.css:74-102` carries `-92px` (`.stageSlot`), `+92px` (`.costSlot`), `-180px` (`.sudoSlot`) and `42%` as plain CSS literals — the same numbers `TableCentre/centre.ts` declares the single source for and hands out through `centrePlaceStyle`. The three new AI places (#106) — `cause`, `effect`, `picked` — already read it; the four old ones do not, being older than the source file itself. While both places hold the same four numbers apart, editing one is an edit that has to be remembered for the other, and nothing fails the build if it is forgotten. What closes it: migrating the four slots onto `centrePlaceStyle`, reading the release and defence sets instead of their own numbers — the same move the three new AI slots already made in this task; not done here because the slots are shipped and approved (Defense Release, #101) and a layout regression is worse than a recorded duplication.',
    },
    where: {
      ru: 'frontend: pages/board/[gameId]/_Board.module.css:74-102, table/TableCentre/centre.ts',
      en: 'frontend: pages/board/[gameId]/_Board.module.css:74-102, table/TableCentre/centre.ts',
    },
    status: 'open',
  },
  {
    what: {
      ru: 'Крашу нечем показать вторую карту: релиз под своим Code Review',
      en: 'A crush has no place for its second card: a release under its own Code Review',
    },
    problem: {
      ru: 'Автоматическое разрушение слота (`destroySlot` без `reason`, `packages/engine/src/fake/triggers.ts:88-92`) выдаёт только `releaseDestroyed` — ни одного `discarded`, — а `toDiscardHeap` складывает кучу по одной карте на `discarded`. Половина закрыта: куча всё-таки показывает одну карту, свою заглушку верха сброса, и у заглушки есть поза `standInScatter(count)`; послебатчевый счётчик приезжает в `planBeats` четвёртым аргументом — так же и по той же причине, что `owed`, — такт летит ровно на эту позу (поле `rest` у `AiTail.crush`), и обе стороны читают одно значение, а не две копии формулы (I7). Осталась вторая карта: `bankToDiscard` кладёт spoils в порядке `[релиз, Code Review]` (проверено на движке), поэтому при наличии Code Review сверху оказывается он, релиз лежит под ним, и в куче для релиза нет ничего — ни события, ни заглушки; позы нет и у самого Code Review. Эти две карты такт отпускает без разброса: придумать им место значит завести второй источник для того, что рисует `toDiscardHeap`. Ветка сегодня недостижима — краш открывает пендинг всегда, потому что целевой слот занят по условию, а значит `sacrifice` всегда в `neutralizeOptions`. Закроет `reason` у автоматического `destroySlot`, чтобы он выдавал `discarded` на каждую карту spoils, как любая другая банковка.',
      en: 'An automatic slot destruction (`destroySlot` with no `reason`, `packages/engine/src/fake/triggers.ts:88-92`) emits `releaseDestroyed` and no `discarded` at all, while `toDiscardHeap` folds the heap one card per `discarded`. Half of this is closed: the heap does still show one card — its stand-in for the discard’s top — and that stand-in has a pose, `standInScatter(count)`; the post-batch count now reaches `planBeats` as a fourth argument, the same way and for the same reason as `owed`, the beat flies onto exactly that pose (`AiTail.crush`’s `rest`), and both ends read one value rather than two copies of a formula (I7). What is left is the second card: `bankToDiscard` banks the spoils as `[release, Code Review]` (verified against the engine), so with a Code Review present it is the Code Review on top, the release lies buried under it, and the heap holds nothing for the release — no event, no stand-in; the Code Review has no pose of its own either. The beat releases those two with no scatter: inventing a place for them would make the board a second source for what `toDiscardHeap` draws. The branch is unreachable today — a crush always opens a pending, because its target slot is occupied by construction and `sacrifice` is therefore always in `neutralizeOptions`. What closes it: a `reason` on the automatic `destroySlot` so it emits `discarded` per spoil, like every other bank.',
    },
    where: {
      ru: 'packages/engine/src/fake/triggers.ts:76-100 + frontend: entities/game/board/toBoardState.ts:160, features/board-beats/aiBeat.tsx',
      en: 'packages/engine/src/fake/triggers.ts:76-100 + frontend: entities/game/board/toBoardState.ts:160, features/board-beats/aiBeat.tsx',
    },
    status: 'open',
  },
]

// Section headings, notes, legend and table headers.
const UI = {
  ru: {
    title: 'Аудит анимаций',
    modulesH: 'Готовые модули',
    modulesNote: 'Самодостаточные кирпичики — один смысл, одна задача.',
    scenariosH: 'Сценарные комбинации',
    scenariosNote:
      'Реализованные последовательности из модулей выше — под конкретные ситуации игры.',
    issuesH: 'Требует доработок',
    issuesNote:
      'Реестр находок: сюда заносится всё, что нашли про анимации. Видимое в сценах — движение, написанное дважды, готовый модуль без применения. И невидимое — нерешённое правило, значение, до которого не дотянуться. Наткнулся на дыру — запиши сюда, а не обходи её на месте.',
    issuesEmpty:
      'Открытых проблем нет — всё свелось к модулям. Правило, на котором держится эта пустота: движение, встретившееся в двух сценах, — это модуль, который ещё не оформили.',
    legendOk: 'оформлено модулем, переиспользуется',
    legendRework: 'код есть, но кривой/дублируется — доработать',
    legendReuse: 'есть готовый модуль, но не используется — применить',
    legendOpen: 'решения нет — нужен выбор, а не работа',
    docsH: 'Спека в проекте',
    docsNote:
      'У этой страницы есть письменная пара — docs/animations/. Здесь состояние в лицах: что готово, из чего собрано, что нашли. Там — как этим пользоваться из игровой логики: README (модель и инварианты I1–I10), recipes (последовательности по игровым ситуациям), reference (вызываемое: пресеты, хелперы, шаги), glossary (параметры и значения), extending (как добавить своё), backlog (развёрнутые находки: чем грозит и что закроет). Правило синхронности одностороннее только на словах: пресет без строки в reference роняет тест.',
    colModule: 'модуль',
    colWhatDoes: 'что делает',
    colWhereMod: 'где живёт · используется',
    colStatus: 'статус',
    colScenario: 'сценарий',
    colImpl: 'реализация · модули и ключевые моменты',
    colWhere: 'кит · где показано',
    colBoard: 'борд · взято в реализацию',
    boardOnly: 'только плейграунд',
    colWhatShort: 'что',
    colProblem: 'проблема',
    copy: 'копировать',
  },
  en: {
    title: 'Animation audit',
    modulesH: 'Ready modules',
    modulesNote: 'Self-contained blocks — one meaning, one task.',
    scenariosH: 'Scenario combinations',
    scenariosNote: 'Implemented sequences from the modules above — for concrete game situations.',
    issuesH: 'Needs rework',
    issuesNote:
      'The register of findings: everything found about the animations lands here. What is visible in the scenes — a movement written twice, a ready module left unused. And what is not — a rule nobody decided, a value out of reach. Run into a gap: write it here instead of working around it in place.',
    issuesEmpty:
      'No open issues — everything reduced to modules. The rule this emptiness rests on: a movement found in two scenes is a module that has not been packaged yet.',
    legendOk: 'packaged as a module, reused',
    legendRework: 'code exists but messy/duplicated — rework',
    legendReuse: 'a ready module exists but unused — apply it',
    legendOpen: 'undecided — it needs a choice, not work',
    docsH: 'The written spec',
    docsNote:
      'This page has a written counterpart — docs/animations/. Here is the state in the flesh: what is ready, what it is assembled from, what has been found. There is how to use it from game logic: README (the model and the I1–I10 invariants), recipes (ordered sequences by game situation), reference (the callable API: presets, helpers, steps), glossary (parameters and values), extending (how to add your own), backlog (findings in full: what it costs and what would close it). The sync rule is one-way only in wording: a preset with no row in reference fails a test.',
    colModule: 'module',
    colWhatDoes: 'what it does',
    colWhereMod: 'where it lives · used',
    colStatus: 'status',
    colScenario: 'scenario',
    colImpl: 'implementation · modules and key points',
    colWhere: 'kit · where it is shown',
    colBoard: 'board · taken into implementation',
    boardOnly: 'playground only',
    colWhatShort: 'what',
    colProblem: 'problem',
    copy: 'copy',
  },
}

function Badge({ status }: { status: Status }) {
  const { lang } = useLang()
  const s = STATUS[status]
  return <span className={`${styles.badge} ${s.cls}`}>{s.label[lang]}</span>
}

// micro "copy module name" button — appears on row hover
function CopyButton({ text }: { text: string }) {
  const { lang } = useLang()
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1100)
    })
  }
  return (
    <button
      type="button"
      className={styles.copyBtn}
      onClick={copy}
      aria-label={`${UI[lang].copy} ${text}`}
      title={UI[lang].copy}
    >
      {copied ? '✓' : '❐'}
    </button>
  )
}

function LegendItem({ status, children }: { status: Status; children: ReactNode }) {
  return (
    <span className={styles.legendItem}>
      <Badge status={status} />
      {children}
    </span>
  )
}

function ModuleTable({ rows }: { rows: Module[] }) {
  const { lang } = useLang()
  const ui = UI[lang]
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{ui.colModule}</th>
          <th>{ui.colWhatDoes}</th>
          <th>{ui.colWhereMod}</th>
          <th>{ui.colStatus}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.mod}>
            <td className={styles.mod}>
              <span className={styles.modCell}>
                <span>{r.mod}</span>
                <CopyButton text={r.mod} />
              </span>
            </td>
            <td className={styles.what}>{r.what[lang]}</td>
            <td className={styles.where}>{r.where[lang]}</td>
            <td>
              <Badge status={r.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ScenarioTable({ rows }: { rows: Scenario[] }) {
  const { lang } = useLang()
  const ui = UI[lang]
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{ui.colScenario}</th>
          <th>{ui.colImpl}</th>
          <th>{ui.colWhere}</th>
          <th>{ui.colBoard}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name.en}>
            <td className={styles.mod}>{r.name[lang]}</td>
            <td className={styles.what}>{r.from[lang]}</td>
            <td className={styles.where}>{r.where}</td>
            <td className={styles.where}>
              {r.board ?? <span className={styles.playgroundOnly}>{ui.boardOnly}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function IssueTable({ rows }: { rows: Issue[] }) {
  const { lang } = useLang()
  const ui = UI[lang]
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{ui.colWhatShort}</th>
          <th>{ui.colProblem}</th>
          <th>{ui.colWhere}</th>
          <th>{ui.colStatus}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.what.en}>
            <td className={styles.mod}>{r.what[lang]}</td>
            <td className={styles.what}>{r.problem[lang]}</td>
            <td className={styles.where}>{r.where[lang]}</td>
            <td>
              <Badge status={r.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function AnimationAuditStory() {
  const { lang } = useLang()
  const ui = UI[lang]
  return (
    <div className={styles.root}>
      <h1 className={styles.title}>{ui.title}</h1>
      <p className={styles.intro}>
        {lang === 'ru' ? (
          <>
            Источник состояния работы с анимациями. Сначала готовые <b>модули</b> — кирпичики для
            сборки. Затем <b>сценарные комбинации</b> — как кирпичики складываются под игровые
            ситуации (сценарий — это последовательность, а не модуль: его не оформляют отдельно,
            поэтому без статусов). И в конце — <b>реестр находок</b>: всё, что нашли про анимации,
            от копии словарного движения в сцене до вопроса, который никто не решил.
          </>
        ) : (
          <>
            The source of state for animation work. First the ready <b>modules</b> — building
            blocks. Then <b>scenario combinations</b> — how the blocks assemble for game situations
            (a scenario is a sequence, not a module: it isn't formalized separately, so no
            statuses). And at the end — the <b>register of findings</b>: everything found about the
            animations, from a scene carrying its own copy of a registry movement to a question
            nobody has decided.
          </>
        )}
      </p>

      <div className={styles.legend}>
        <LegendItem status="ok">{ui.legendOk}</LegendItem>
        <LegendItem status="rework">{ui.legendRework}</LegendItem>
        <LegendItem status="reuse">{ui.legendReuse}</LegendItem>
        <LegendItem status="open">{ui.legendOpen}</LegendItem>
      </div>

      {/* the written half of the same subject — named on the page itself, so it
          is reachable from where the work is looked at */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{ui.docsH}</h2>
        <p className={styles.sectionNote}>{ui.docsNote}</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{ui.modulesH}</h2>
        <p className={styles.sectionNote}>{ui.modulesNote}</p>
        <ModuleTable rows={MODULES} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{ui.scenariosH}</h2>
        <p className={styles.sectionNote}>{ui.scenariosNote}</p>
        <ScenarioTable rows={SCENARIOS} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{ui.issuesH}</h2>
        <p className={styles.sectionNote}>{ui.issuesNote}</p>
        {ISSUES.length > 0 ? (
          <IssueTable rows={ISSUES} />
        ) : (
          <p className={styles.sectionNote}>{ui.issuesEmpty}</p>
        )}
      </section>
    </div>
  )
}
