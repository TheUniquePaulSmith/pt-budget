import 'i18next';

import type { EN_US_RESOURCES } from '@/lib/i18n';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    returnNull: false;
    resources: typeof EN_US_RESOURCES;
  }
}
