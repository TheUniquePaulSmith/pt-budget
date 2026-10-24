import type { AiToolConsent } from '@/types/database';
import type { AiToolCrud } from '@/types/aiTools';

/** Safe defaults: reads run freely, writes ask, deletes ask and start disabled. */
export function consentDefaultForCrud(crud: AiToolCrud): AiToolConsent {
  return crud === 'read' ? 'always' : 'ask';
}

export function enabledDefaultForCrud(crud: AiToolCrud): boolean {
  return crud !== 'delete';
}
