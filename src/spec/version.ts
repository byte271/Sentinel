<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ---------------------------------------------------------------------------
// Canonical version — single source of truth (B1).
// ---------------------------------------------------------------------------
// The version lives in exactly one place: package.json. Every module that
// needs a version string reads it from here, which reads it from package.json.
// This guarantees the CLI, the spec declaration, and the compliance profile
// can never drift out of sync with the published package version.
//
// package.json sits two levels up from this module whether we run from source
// (`src/spec/version.ts`) or from the compiled output (`dist/spec/version.js`),
// so the same relative resolution works in both environments.
// ---------------------------------------------------------------------------

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    if (typeof pkg.version === 'string' && pkg.version.length > 0) {
      return pkg.version;
    }
  } catch {
    // Fall through to the pinned fallback below.
  }
  // Fallback only used if package.json is unreadable (e.g. an exotic bundling
  // setup). Kept in lockstep with package.json by the release process.
  return '0.2.0';
}

export const SENTINEL_VERSION = readPackageVersion();
<<<<<<< HEAD
=======
=======
export const SENTINEL_VERSION = '0.1.0';
>>>>>>> e550e260dcc2f57c57596854a8be22259fd660ce
>>>>>>> ac8649639ea7b180de767e25c1cc662b58f96dc7
export const SENTINEL_PROTOCOL_VERSION = 1;

export interface SpecDeclaration {
  protocolVersion: number;
  modules: string[];
  features: string[];
  extensions: string[];
}

export class SpecManager {
  private extensions: Map<string, { version: string; description: string }> = new Map();

  getSpec(): SpecDeclaration {
    return {
      protocolVersion: SENTINEL_PROTOCOL_VERSION,
      modules: [
        'kernel', 'info', 'magic', 'spec', 'api', 'exec', 'safe', 'trace', 'id',
        'persist', 'compliance', 'bridge',
      ],
      features: [
        'shadow-execution',
        'state-management',
        'magic-recovery',
        'action-tracing',
        'risk-assessment',
        'temporal-branching',
        'durable-persistence',
        'nist-compliance',
        'a2a-safety-bridge',
      ],
      extensions: Array.from(this.extensions.keys()),
    };
  }

  checkCompatibility(remoteVersion: number): { compatible: boolean; reason?: string } {
    if (remoteVersion === SENTINEL_PROTOCOL_VERSION) {
      return { compatible: true };
    }
    if (remoteVersion > SENTINEL_PROTOCOL_VERSION) {
      return {
        compatible: false,
        reason: `Remote protocol version ${remoteVersion} is newer than local version ${SENTINEL_PROTOCOL_VERSION}`,
      };
    }
    return {
      compatible: false,
      reason: `Remote protocol version ${remoteVersion} is older than local version ${SENTINEL_PROTOCOL_VERSION}`,
    };
  }

  registerExtension(name: string, version: string, description: string): void {
    this.extensions.set(name, { version, description });
  }

  listExtensions(): Array<{ name: string; version: string; description: string }> {
    return Array.from(this.extensions.entries()).map(([name, ext]) => ({
      name,
      version: ext.version,
      description: ext.description,
    }));
  }

  negotiate(remoteSpec: SpecDeclaration): { agreed: string[]; unsupported: string[] } {
    const localSpec = this.getSpec();
    const localFeatures = new Set(localSpec.features);
    const agreed: string[] = [];
    const unsupported: string[] = [];

    for (const feature of remoteSpec.features) {
      if (localFeatures.has(feature)) {
        agreed.push(feature);
      } else {
        unsupported.push(feature);
      }
    }

    return { agreed, unsupported };
  }
}
