import { describe, expect, it } from 'vitest';

import { parseRemoteTags, pickReleaseTag, RELEASE_BRANCH, resolveAppVersion } from './appVersion';

const COMMIT = '77a2fae0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6';

describe('resolveAppVersion', () => {
  it('shows the release tag on the release branch, without its leading v', () => {
    expect(
      resolveAppVersion({ branch: RELEASE_BRANCH, commitSha: COMMIT, shortSha: '77a2fae', tagsAtCommit: ['v1.2.0'] })
    ).toBe('1.2.0');
  });

  it('shows the short commit hash on any other branch, even when the commit is tagged', () => {
    expect(
      resolveAppVersion({ branch: 'devel/latest', commitSha: COMMIT, shortSha: '77a2fae', tagsAtCommit: ['v1.2.0'] })
    ).toBe('77a2fae');
  });

  it('falls back to the commit hash on the release branch when the commit has no release tag', () => {
    expect(resolveAppVersion({ branch: RELEASE_BRANCH, commitSha: COMMIT, shortSha: '77a2fae', tagsAtCommit: [] })).toBe(
      '77a2fae'
    );
    expect(
      resolveAppVersion({ branch: RELEASE_BRANCH, commitSha: COMMIT, shortSha: '77a2fae', tagsAtCommit: ['nightly'] })
    ).toBe('77a2fae');
  });

  it('prefers the APP_VERSION override over everything else', () => {
    expect(
      resolveAppVersion({ override: ' v2.0.0-beta.1 ', branch: RELEASE_BRANCH, commitSha: COMMIT, tagsAtCommit: ['v1.2.0'] })
    ).toBe('2.0.0-beta.1');
    expect(resolveAppVersion({ override: 'vnext', branch: 'devel/latest', commitSha: COMMIT })).toBe('vnext');
  });

  it('ignores a blank override', () => {
    expect(resolveAppVersion({ override: '  ', branch: 'devel/latest', commitSha: COMMIT, shortSha: '77a2fae' })).toBe(
      '77a2fae'
    );
  });

  it('derives a short hash from the full one when git gave no abbreviation', () => {
    expect(resolveAppVersion({ branch: 'devel/latest', commitSha: COMMIT })).toBe('77a2fae');
  });

  it('returns "dev" when nothing is known about the commit', () => {
    expect(resolveAppVersion({})).toBe('dev');
    expect(resolveAppVersion({ branch: RELEASE_BRANCH, commitSha: '', shortSha: null })).toBe('dev');
  });
});

describe('pickReleaseTag', () => {
  it('picks the highest release when a commit carries several tags', () => {
    expect(pickReleaseTag(['v1.9.0', 'v1.10.0', 'v1.2.10'])).toBe('v1.10.0');
  });

  it('ranks a release above its own pre-releases, and later pre-releases above earlier ones', () => {
    expect(pickReleaseTag(['v1.0.0-rc.2', 'v1.0.0', 'v1.0.0-rc.10'])).toBe('v1.0.0');
    expect(pickReleaseTag(['v1.0.0-rc.2', 'v1.0.0-rc.10'])).toBe('v1.0.0-rc.10');
  });

  it('accepts a tag without the v prefix and ignores tags that are not versions', () => {
    expect(pickReleaseTag(['latest', '1.4.0', 'release-candidate', 'v1.4'])).toBe('1.4.0');
    expect(pickReleaseTag(['latest', 'v1'])).toBeNull();
    expect(pickReleaseTag([])).toBeNull();
  });
});

describe('parseRemoteTags', () => {
  const OTHER = '0123456789abcdef0123456789abcdef01234567';
  const TAG_OBJECT = 'fedcba9876543210fedcba9876543210fedcba98';

  it('returns the lightweight and annotated tags pointing at the commit', () => {
    const output = [
      `${OTHER}\trefs/tags/v0.9.0`,
      `${COMMIT}\trefs/tags/v1.0.0`,
      `${TAG_OBJECT}\trefs/tags/v1.0.1`,
      `${COMMIT}\trefs/tags/v1.0.1^{}`,
    ].join('\n');

    expect(parseRemoteTags(output, COMMIT)).toEqual(['v1.0.0', 'v1.0.1']);
  });

  it('returns nothing for empty output or when no tag points at the commit', () => {
    expect(parseRemoteTags('', COMMIT)).toEqual([]);
    expect(parseRemoteTags(`${OTHER}\trefs/tags/v0.9.0\n`, COMMIT)).toEqual([]);
  });

  it('ignores refs that are not tags', () => {
    expect(parseRemoteTags(`${COMMIT}\trefs/heads/main\n${COMMIT}\tHEAD`, COMMIT)).toEqual([]);
  });
});
