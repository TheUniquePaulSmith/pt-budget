/**
 * The app version shown in the status-bar footer. `next.config.ts` resolves
 * it once per build and inlines it as `NEXT_PUBLIC_APP_VERSION`:
 *
 *   - `APP_VERSION` build variable: used as is (an escape hatch).
 *   - A build of the release branch (`main`, app.ptbudget.com): the release
 *     tag (`vX.Y.Z`) pointing at the commit being built.
 *   - Everything else (dev.ptbudget.com, previews, local): the short commit
 *     hash.
 *
 * The footer prints a "v" in front of whatever this returns, so a tag loses
 * its own leading "v" here: tag `v1.2.0` shows as "v1.2.0", commit `77a2fae`
 * as "v77a2fae".
 *
 * Pure: the caller passes in what git and the environment say, so this file
 * has no Node dependency and is trivial to test.
 */

export const RELEASE_BRANCH = 'main';

const SHORT_SHA_LENGTH = 7;
const FALLBACK_VERSION = 'dev';
const RELEASE_TAG = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export interface AppVersionInputs {
  /** The `APP_VERSION` build variable. */
  override?: string | null;
  /** Branch being built (`WORKERS_CI_BRANCH` on Cloudflare, else git). */
  branch?: string | null;
  /** Full hash of the commit being built. */
  commitSha?: string | null;
  /** git's own abbreviation of `commitSha`; derived from it when missing. */
  shortSha?: string | null;
  /** Every tag pointing at the commit being built. */
  tagsAtCommit?: readonly string[];
}

interface ParsedReleaseTag {
  tag: string;
  core: [number, number, number];
  preRelease: string | null;
}

function parseReleaseTag(tag: string): ParsedReleaseTag | null {
  const match = RELEASE_TAG.exec(tag.trim());
  if (!match) return null;
  return {
    tag: tag.trim(),
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    preRelease: match[4] ?? null,
  };
}

/** Highest first; a pre-release (`1.2.0-rc.1`) sorts below its release. */
function compareReleaseTags(a: ParsedReleaseTag, b: ParsedReleaseTag): number {
  for (let i = 0; i < a.core.length; i += 1) {
    if (a.core[i] !== b.core[i]) return b.core[i] - a.core[i];
  }
  if ((a.preRelease === null) !== (b.preRelease === null)) return a.preRelease === null ? -1 : 1;
  return (b.preRelease ?? '').localeCompare(a.preRelease ?? '', 'en', { numeric: true });
}

/** The highest release tag (`vX.Y.Z`, optionally `-pre.release`) in `tags`, or null. */
export function pickReleaseTag(tags: readonly string[]): string | null {
  const releases = tags.map(parseReleaseTag).filter((parsed): parsed is ParsedReleaseTag => parsed !== null);
  releases.sort(compareReleaseTags);
  return releases[0]?.tag ?? null;
}

/**
 * Tag names pointing at `commitSha` in `git ls-remote --tags` output. An
 * annotated tag is listed twice: once with the tag object's hash, once as
 * `refs/tags/<name>^{}` with the commit it points at.
 */
export function parseRemoteTags(lsRemoteOutput: string, commitSha: string): string[] {
  const names = lsRemoteOutput
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([sha, ref]) => sha === commitSha && ref?.startsWith('refs/tags/'))
    .map(([, ref]) => ref.slice('refs/tags/'.length).replace(/\^\{\}$/, ''));
  return [...new Set(names)];
}

function stripLeadingV(version: string): string {
  return /^v\d/.test(version) ? version.slice(1) : version;
}

export function resolveAppVersion(inputs: AppVersionInputs): string {
  const override = inputs.override?.trim();
  if (override) return stripLeadingV(override);

  if (inputs.branch === RELEASE_BRANCH) {
    const tag = pickReleaseTag(inputs.tagsAtCommit ?? []);
    if (tag) return stripLeadingV(tag);
  }

  const commitSha = inputs.commitSha?.trim();
  return inputs.shortSha?.trim() || commitSha?.slice(0, SHORT_SHA_LENGTH) || FALLBACK_VERSION;
}
