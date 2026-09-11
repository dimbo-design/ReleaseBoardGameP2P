import { en as enCommon, ru as ruCommon } from '@release/translation/catalog'
import { useState } from 'react'
import Chat, { type ChatMessage, type ChatRole } from '@/blocks/Chat'
import { CHAT_SELF, makeChat } from '@/mocks/chat'
import Lobby from '@/screens/Lobby'
import { pick, useLang } from '../../Playground/lang'
import TechBar from '../controls/TechBar'
import { TechSwitch } from '../controls/TechControls'
import styles from './LobbyChatStory.module.css'

export default function LobbyChatStory() {
  const { lang } = useLang()
  const [role, setRole] = useState<'host' | 'guest'>('host')
  const [bg, setBg] = useState<'neutral' | 'positive' | 'problem'>('neutral')
  const [messages, setMessages] = useState<ChatMessage[]>(makeChat)
  // Роль отправителя — это ответ на вопрос «кто я в этой комнате», поэтому в неё
  // перекрашивается ВСЯ моя сторона ленты, а не только следующая отправка.
  const [myRole, setMyRole] = useState<ChatRole>('player')
  // отправка локальная: экран лобби чат не ведёт, он только даёт ему место
  const send = (text: string) =>
    setMessages((prev) => [
      ...prev,
      { id: `local-${prev.length}`, who: CHAT_SELF, role: myRole, text, time: '20:17' },
    ])
  const shown = messages.map((m) => (m.system || m.who !== CHAT_SELF ? m : { ...m, role: myRole }))
  return (
    <div className={styles.root}>
      <TechBar>
        <TechSwitch
          options={[
            { value: 'host', label: 'host' },
            { value: 'guest', label: 'guest' },
          ]}
          value={role}
          onChange={setRole}
        />
        <TechSwitch
          options={[
            { value: 'neutral', label: 'neutral' },
            { value: 'positive', label: 'positive' },
            { value: 'problem', label: 'problem' },
          ]}
          value={bg}
          onChange={setBg}
        />
        <TechSwitch
          label="my role"
          options={[
            { value: 'host', label: 'host' },
            { value: 'player', label: 'player' },
            { value: 'spectator', label: 'spectator' },
          ]}
          value={myRole}
          onChange={setMyRole}
        />
      </TechBar>
      {/* стартовый язык лобби берём из языка плейграунда; дальше им управляет
          встроенный в лобби свитчер. key переинициализирует экран при смене
          языка плейграунда из шапки */}
      <div className={styles.stage}>
        <Lobby
          key={lang}
          role={role}
          initialLang={lang}
          bgTone={bg}
          lobbyCodeCopy={{ ru: ruCommon.lobbyCode, en: enCommon.lobbyCode }}
          gameModesCopy={{ ru: ruCommon.gameModes, en: enCommon.gameModes }}
          rulesBlockCopy={{ ru: ruCommon.rulesBlock, en: enCommon.rulesBlock }}
          lobbyScreenCopy={{ ru: ruCommon.lobbyScreen, en: enCommon.lobbyScreen }}
          chat={
            <Chat
              messages={shown}
              copy={pick(lang, { ru: ruCommon.chat, en: enCommon.chat })}
              selfName={CHAT_SELF}
              onSend={send}
            />
          }
        />
      </div>
    </div>
  )
}
