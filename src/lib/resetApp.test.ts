import { describe, expect, it } from 'vitest';

import { LOGS_DB_NAME } from './logging';
import { selectDatabasesToDelete } from './resetApp';

describe('resetApp', () => {
  it('keeps the diagnostic log database unless asked to clear it', () => {
    const existing = ['ptbudgetapp-v2-encrypted', LOGS_DB_NAME, 'something-else'];

    expect(selectDatabasesToDelete(existing, false)).toEqual([
      'ptbudgetapp-v2-encrypted',
      'ptbudgetapp-keys',
      'something-else',
    ]);
    expect(selectDatabasesToDelete(existing, true)).toEqual(
      expect.arrayContaining(['ptbudgetapp-v2-encrypted', 'ptbudgetapp-keys', 'something-else', LOGS_DB_NAME])
    );
  });

  it('always includes the known databases and the log database when asked, even if databases() is unavailable', () => {
    expect(selectDatabasesToDelete([], false)).toEqual(['ptbudgetapp-v2-encrypted', 'ptbudgetapp-keys']);
    expect(selectDatabasesToDelete([], true)).toEqual(['ptbudgetapp-v2-encrypted', 'ptbudgetapp-keys', LOGS_DB_NAME]);
  });
});
