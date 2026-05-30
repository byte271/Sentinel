// ---------------------------------------------------------------------------
// B1: Version single-source-of-truth regression tests.
// ---------------------------------------------------------------------------
// These guard against the historical bug where package.json said "0.1.0" while
// the compliance module hardcoded PROFILE_VERSION = "0.4.0". Everything must
// now resolve to the one value in package.json.
// ---------------------------------------------------------------------------

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';
import { SENTINEL_VERSION } from '../src/spec/version.js';
import { NistComplianceProfile } from '../src/compliance/nist.js';

function packageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf-8')) as { version: string };
  return pkg.version;
}

describe('version single source of truth', () => {
  it('SENTINEL_VERSION matches package.json exactly', () => {
    expect(SENTINEL_VERSION).toBe(packageVersion());
  });

  it('is a valid semver string', () => {
    expect(SENTINEL_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('NIST compliance report profileVersion delegates to the canonical version', () => {
    const profile = new NistComplianceProfile();
    const report = profile.generateReport({});
    expect(report.profileVersion).toBe(SENTINEL_VERSION);
  });

<<<<<<< HEAD
  it('the canonical version is 0.3.0 for this release', () => {
    expect(SENTINEL_VERSION).toBe('0.3.0');
=======
  it('the canonical version is 0.2.0 for this release', () => {
    expect(SENTINEL_VERSION).toBe('0.2.0');
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7
  });
});
