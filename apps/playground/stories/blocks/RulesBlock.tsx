import { en as enCommon, ru as ruCommon } from '@release/translation/catalog'
import Rules from '@/blocks/Rules'
import { pick, useLang } from '../../Playground/lang'
import { KitPage, KitSection } from '../kit/KitShell'
import styles from './RulesBlock.module.css'

// Rules preview in a window context: the content area is capped at the wide
// modal width (Modal `wide`), the background/border echo the modal panel. The
// ready Rules element from @release/ui; copy follows the playground toggle (RU/EN).
export default function RulesBlock() {
  const { lang } = useLang()
  return (
    <KitPage title="Rules" tag="block">
      <KitSection
        title={pick(lang, {
          ru: 'Превью в окне — ширина широкой модалки',
          en: 'In-window preview — wide modal width',
        })}
      >
        <div className={styles.panel}>
          <Rules
            copy={pick(lang, { ru: ruCommon.rulesBlock, en: enCommon.rulesBlock })}
            lang={lang}
          />
        </div>
      </KitSection>
    </KitPage>
  )
}
