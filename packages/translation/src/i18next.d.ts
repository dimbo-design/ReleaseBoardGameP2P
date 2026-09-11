import 'i18next'
import type { en } from './catalog'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: { common: typeof en }
  }
}
