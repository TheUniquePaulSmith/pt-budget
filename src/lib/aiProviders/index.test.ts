import { describe, expect, it, vi } from 'vitest';

import { createProviderFromProfile } from './index';
import type { AiProviderProfile } from './types';

describe('createProviderFromProfile', () => {
  it('builds an OpenAI-compatible provider for a local endpoint profile', async () => {
    const profile: AiProviderProfile = {
      id: 'lab',
      kind: 'local_endpoint',
      label: 'Lab box',
      baseUrl: 'https://lab.internal:8443/v1',
      model: 'qwen2.5',
      isActive: true,
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'qwen2.5' }] }), { status: 200 }));

    const provider = createProviderFromProfile(profile, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await provider.testConnection();

    expect(provider).toMatchObject({ id: 'lab', kind: 'local_endpoint', model: 'qwen2.5' });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://lab.internal:8443/v1/models');
    expect(result).toMatchObject({ ok: true, models: ['qwen2.5'] });
  });
});
