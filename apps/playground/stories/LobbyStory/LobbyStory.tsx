import { en as enCommon, ru as ruCommon } from '@release/translation/catalog'
import { useState } from 'react'
import Lobby from '@/screens/Lobby'
import { useLang } from '../../Playground/lang'
import TechBar from '../controls/TechBar'
import { TechSwitch } from '../controls/TechControls'
import styles from './LobbyStory.module.css'

export default function LobbyStory() {
  const { lang } = useLang()
  const [role, setRole] = useState<'host' | 'guest'>('host')
  const [bg, setBg] = useState<'neutral' | 'positive' | 'problem'>('neutral')
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
        />
      </div>
    </div>
  )
}
