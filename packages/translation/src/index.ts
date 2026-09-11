/// <reference path="./i18next.d.ts" />
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import { en, ru } from './catalog'

// Re-export the React binding so the app has a single i18n surface
// (`@release/translation`) and never imports `react-i18next` directly.
export { Trans, useTranslation } from 'react-i18next'

export const resources = {
  en: { common: en },
  ru: { common: ru },
} as const

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['en', 'ru'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
  })

export default i18n
