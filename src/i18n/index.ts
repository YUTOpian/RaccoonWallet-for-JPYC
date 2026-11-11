import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import messages from './messages.json';

// messages.json is carried over verbatim from the Vue app (vue-i18n's format is a plain
// { locale: { namespace: { key: value } } } object, which react-i18next's resources shape
// also accepts directly — no conversion needed).
i18n
  .use(initReactI18next)
  .init({
    resources: {
      ja: { translation: messages.ja },
      en: { translation: messages.en },
    },
    lng: 'ja',
    fallbackLng: 'ja',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
