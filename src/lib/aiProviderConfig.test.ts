import { describe, expect, it } from 'vitest';

import {
  createDefaultProfile,
  getActiveProfile,
  isCloudKind,
  kindLabel,
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

  it('builds a local endpoint profile that needs a URL but no key', () => {
    const profile = createDefaultProfile('local_endpoint');
    expect(profile).toMatchObject({ kind: 'local_endpoint', label: 'Local endpoint', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: '' });

    expect(validateProfile({ ...profile, model: 'llama3.1' }).valid).toBe(true);
    expect(validateProfile({ ...profile, model: 'm', baseUrl: '' }).errors.baseUrl).toBeDefined();
    expect(validateProfile({ ...profile, model: 'm', baseUrl: 'localhost:1234' }).errors.baseUrl).toMatch(/http/);
  });

  it('lets a connection test run without a model but still requires one to save', () => {
    const profile = createDefaultProfile('local_endpoint');
    expect(validateProfile(profile).errors.model).toBeDefined();
    expect(validateProfile(profile, { requireModel: false }).valid).toBe(true);
    expect(validateProfile({ ...profile, baseUrl: '' }, { requireModel: false }).valid).toBe(false);
  });

  it('keeps local endpoint profiles and the client certificate flag through normalization', () => {
    const config = normalizeProviderConfig({
      profiles: [
        { id: 'e', kind: 'local_endpoint', label: 'Lab box', model: 'llama3.1', baseUrl: 'https://lab:8443/v1', useClientCertificate: true, isActive: true },
        { id: 'f', kind: 'local_endpoint', label: 'Plain', model: 'm', useClientCertificate: 'yes' },
      ],
    });
    expect(config.profiles[0]).toMatchObject({ kind: 'local_endpoint', useClientCertificate: true, isActive: true });
    expect(config.profiles[1]).not.toHaveProperty('useClientCertificate');
  });

  it('tells cloud kinds apart from local ones and labels the local endpoint', () => {
    expect(isCloudKind('anthropic')).toBe(true);
    expect(isCloudKind('openai_compatible')).toBe(true);
    expect(isCloudKind('local_endpoint')).toBe(false);
    expect(isCloudKind('local')).toBe(false);
    expect(kindLabel('local_endpoint')).toBe('Local endpoint');
  });
});
