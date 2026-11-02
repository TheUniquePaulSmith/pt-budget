/**
 * MUI locale packs per supported language. Passed as extra arguments to
 * `createTheme` so DataGrid chrome, date-picker chrome and core components
 * (pagination, rating, alerts) follow the active language theme-wide.
 */

import {
  deDE as coreDeDE,
  enUS as coreEnUS,
  esES as coreEsES,
  frFR as coreFrFR,
  itIT as coreItIT,
  jaJP as coreJaJP,
  koKR as coreKoKR,
  ptBR as corePtBR,
  zhCN as coreZhCN,
} from '@mui/material/locale';
import {
  deDE as gridDeDE,
  enUS as gridEnUS,
  esES as gridEsES,
  frFR as gridFrFR,
  itIT as gridItIT,
  jaJP as gridJaJP,
  koKR as gridKoKR,
  ptBR as gridPtBR,
  zhCN as gridZhCN,
} from '@mui/x-data-grid/locales';
import {
  deDE as pickersDeDE,
  enUS as pickersEnUS,
  esES as pickersEsES,
  frFR as pickersFrFR,
  itIT as pickersItIT,
  jaJP as pickersJaJP,
  koKR as pickersKoKR,
  ptBR as pickersPtBR,
  zhCN as pickersZhCN,
} from '@mui/x-date-pickers/locales';

import type { LanguageCode } from '@/lib/i18n';

export type MuiLocalePacks = readonly [core: object, grid: object, pickers: object];

const PACKS: Record<LanguageCode, MuiLocalePacks> = {
  'en-US': [coreEnUS, gridEnUS, pickersEnUS],
  es: [coreEsES, gridEsES, pickersEsES],
  fr: [coreFrFR, gridFrFR, pickersFrFR],
  de: [coreDeDE, gridDeDE, pickersDeDE],
  zh: [coreZhCN, gridZhCN, pickersZhCN],
  ja: [coreJaJP, gridJaJP, pickersJaJP],
  ko: [coreKoKR, gridKoKR, pickersKoKR],
  pt: [corePtBR, gridPtBR, pickersPtBR],
  it: [coreItIT, gridItIT, pickersItIT],
};

export function muiLocalePacksFor(code: LanguageCode): MuiLocalePacks {
  return PACKS[code] ?? PACKS['en-US'];
}
