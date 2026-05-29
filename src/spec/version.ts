export const SENTINEL_VERSION = '0.1.0';
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
