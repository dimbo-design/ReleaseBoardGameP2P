import { en as enCommon } from '@release/translation/catalog'
import { makeTable } from '@/mocks/table'
import type { TableProps } from './types'

// Full, valid props for Table. Tests override only the slice they assert on:
//   makeTableProps({ room: { ...base.room, role: 'guest' } })
export function makeTableProps(over: Partial<TableProps> = {}): TableProps {
  const mock = makeTable(3)
  return {
    state: {
      you: mock.you,
      opponents: mock.opponents,
      decks: mock.decks,
      turn: mock.turn,
      selfId: 'you',
      history: mock.history,
      setup: mock.setup,
      playable: [],
      frozen: [],
    },
    room: {
      role: 'host',
      code: '4F2A-9K',
      participants: mock.participants,
      spectators: mock.spectators,
    },
    copy: {
      table: {
        ...enCommon.table,
        generalTitle: 'general',
        pauseGame: 'pause game',
        pauseOn: 'on',
        pauseOff: 'off',
        pauseHint: 'freezes the turn timer for everyone',
      },
      modes: enCommon.gameModes,
      rules: enCommon.rulesBlock,
      seat: enCommon.seat,
      participants: enCommon.participants,
      history: enCommon.moveHistory,
      reconnect: enCommon.reconnect,
      gameOver: enCommon.gameOver,
      lobbyCode: enCommon.lobbyCode,
      turnDock: enCommon.turnDock,
      pending: enCommon.pending,
      window: enCommon.window,
    },
    // A frozen clock, so a test that does not care about the countdown gets a
    // stable one and a test that does overrides it with both bounds it needs.
    now: 0,
    ...over,
  } as TableProps
}
