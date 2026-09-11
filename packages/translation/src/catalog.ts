import enCommon from './locales/en/common.json'
import enRules from './locales/en/rules.json'
import ruCommon from './locales/ru/common.json'
import ruRules from './locales/ru/rules.json'

// The rules text lives in files of its own so it can carry its own licence
// (CC BY-NC-SA 4.0, see REUSE.toml), apart from the UI copy around it. This is
// where the two are folded back into one catalog per locale, so every key keeps
// the path it always had — `rulesBlock.text` is still `rulesBlock.text`.
//
// Free of side effects on purpose: the playground and the kit's test fixtures
// read the catalogs directly, and must not start i18next to do it.
const withRules = (common: typeof enCommon, rules: typeof enRules) => ({
  ...common,
  rules: { ...common.rules, ...rules.rules },
  rulesBlock: { ...common.rulesBlock, ...rules.rulesBlock },
})

export const en = withRules(enCommon, enRules)
export const ru = withRules(ruCommon, ruRules)
