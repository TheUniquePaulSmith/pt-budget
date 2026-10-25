import { describe, expect, it } from 'vitest';

import {
  createDefaultProfile,
  getActiveProfile,
  normalizeProviderConfig,
  redactApiKey,
  redactProfile,
  removeProfile,
  setActiveProfile,
  upsertProfile,
  validateProfile,
} from './aiProviderConfig';

describe('aiProviderConfig', () => {
  it('normalizes stored documents and keeps a single active profile', () => {
    const config = normalizeProviderConfig({
      profiles: [
        { id: 'a', kind: 'anthropic', label: 'A', model: 'claude-sonnet-5-5', apiKey: 'k', isActive: true },
        { id: 'b', kind: 'openai', label: 'B', model: 'gpt', isActive: true },
        { id: 'bad', kind: 'nope', label: 'x', model: 'y' },
        'garbage',
      ],
    });
    expect(config.profiles.map((profile) => profile.id)).toEqual(['a', 'b']);
    expect(config.profiles.filter((profile) => profile.isActive)).toHaveLength(1);
    expect(normalizeProviderConfig(null).profiles).toEqual([]);
    expect(normalizeProviderConfig({ profiles: 'x' }).profiles).toEqual([]);
  });

  it('upserts, activates and removes profiles', () => {
    const a = { ...createDefaultProfile('anthropic'), id: 'a', apiKey: 'k1' };
    const b = { ...createDefaultProfile('openai_compatible'), id: 'b', isActive: true };
    let config = upsertProfile({ version: 1, profiles: [] }, a);
    config = upsertProfile(config, b);
    expect(getActiveProfile(config)?.id).toBe('b');

    config = upsertProfile(config, { ...a, label: 'Renamed', isActive: true });
    expect(getActiveProfile(config)?.id).toBe('a');
    expect(config.profiles.find((profile) => profile.id === 'a')?.label).toBe('Renamed');

    config = setActiveProfile(config, null);
    expect(getActiveProfile(config)).toBeNull();

    config = removeProfile(config, 'a');
    expect(config.profiles.map((profile) => profile.id)).toEqual(['b']);
  });

  it('redacts keys for logs', () => {
    expect(redactApiKey('sk-ant-1234567890abcdef')).toBe('sk-a…cdef');
    expect(redactApiKey('short')).toBe('••••');
    expect(redactApiKey(undefined)).toBe('');
    const profile = { ...createDefaultProfile('anthropic'), apiKey: 'secret-key-value' };
    expect(redactProfile(profile).apiKey).toBe('[redacted]');
    expect(JSON.stringify(redactProfile(profile))).not.toContain('secret-key-value');
  });

  it('validates required fields per kind', () => {
    expect(validateProfile({ ...createDefaultProfile('anthropic'), apiKey: '' }).errors.apiKey).toBeDefined();
    expect(validateProfile({ ...createDefaultProfile('openai_compatible'), baseUrl: '', model: '' }).errors).toMatchObject({
      baseUrl: expect.any(String),
      model: expect.any(String),
    });
    expect(validateProfile({ ...createDefaultProfile('openai_compatible'), baseUrl: 'localhost:1234', model: 'm' }).errors.baseUrl).toMatch(/http/);
    expect(validateProfile({ ...createDefaultProfile('openai'), apiKey: 'k' }).valid).toBe(true);
  });
});
