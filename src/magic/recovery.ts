import { v4 as uuid } from 'uuid';
import type { Surface, SurfaceCapability, SurfaceManifest, RiskLevel, ParamSchema } from '../kernel/types.js';

export interface InferredCapability extends SurfaceCapability {
  confidence: number;
  source: string;
  inferredAt: number;
}

export interface ProbeResult {
  surfaceId: string;
  discovered: InferredCapability[];
  ambiguityScore: number;
  warnings: string[];
}

const RISK_PATTERNS: Array<{ keywords: string[]; riskLevel: RiskLevel; category: string }> = [
  { keywords: ['get', 'list', 'read', 'fetch', 'show'], riskLevel: 'low', category: 'read-only' },
  { keywords: ['create', 'add', 'new', 'insert'], riskLevel: 'medium', category: 'write' },
  { keywords: ['update', 'edit', 'modify', 'set'], riskLevel: 'medium', category: 'write' },
  { keywords: ['delete', 'remove', 'drop', 'destroy'], riskLevel: 'high', category: 'destructive' },
  { keywords: ['deploy', 'publish', 'release'], riskLevel: 'high', category: 'external' },
  { keywords: ['pay', 'charge', 'refund', 'transfer'], riskLevel: 'critical', category: 'financial' },
];

export class MagicRecovery {
  inferCapabilities(hints: {
    actions?: string[];
    endpoints?: string[];
    uiElements?: string[];
    cliCommands?: string[];
  }): InferredCapability[] {
    const capabilities: InferredCapability[] = [];
    const allHints: Array<{ name: string; source: string }> = [];

    for (const action of hints.actions ?? []) {
      allHints.push({ name: action, source: 'action' });
    }
    for (const endpoint of hints.endpoints ?? []) {
      allHints.push({ name: endpoint, source: 'endpoint' });
    }
    for (const el of hints.uiElements ?? []) {
      allHints.push({ name: el, source: 'ui-element' });
    }
    for (const cmd of hints.cliCommands ?? []) {
      allHints.push({ name: cmd, source: 'cli-command' });
    }

    for (const hint of allHints) {
      const { riskLevel, confidence, category } = this.classifyAction(hint.name);
      const params = this.inferParams(hint.name);

      // Read-only actions are trivially reversible (no state change)
      const isReversible = category === 'read-only';
      capabilities.push({
        action: hint.name,
        description: `Inferred ${category} capability from ${hint.source}: ${hint.name}`,
        riskLevel,
        params,
        confidence,
        source: hint.source,
        inferredAt: Date.now(),
        reversible: isReversible,
        requiresApproval: riskLevel === 'high' || riskLevel === 'critical',
      });
    }

    return capabilities;
  }

  inferParams(actionName: string, sampleData?: Record<string, unknown>): ParamSchema[] {
    const params: ParamSchema[] = [];
    const nameLower = actionName.toLowerCase();

    // Infer an ID param for actions that target a specific resource
    if (/get|read|fetch|show|update|edit|modify|delete|remove|drop|destroy/.test(nameLower)) {
      params.push({
        name: 'id',
        type: 'string',
        required: true,
        description: 'Resource identifier',
      });
    }

    // Infer a data/body param for write actions
    if (/create|add|new|insert|update|edit|modify|set/.test(nameLower)) {
      params.push({
        name: 'data',
        type: 'object',
        required: true,
        description: 'Data payload',
      });
    }

    // Infer params from sample data keys
    if (sampleData) {
      for (const [key, value] of Object.entries(sampleData)) {
        const alreadyExists = params.some((p) => p.name === key);
        if (!alreadyExists) {
          params.push({
            name: key,
            type: typeof value,
            required: false,
            description: `Inferred from sample data`,
          });
        }
      }
    }

    return params;
  }

  assessAmbiguity(surface: Partial<Surface>): { score: number; issues: string[] } {
    const issues: string[] = [];
    let ambiguityPoints = 0;
    const maxPoints = 5;

    if (!surface.manifest) {
      issues.push('Missing manifest');
      ambiguityPoints++;
    }

    if (!surface.capabilities || surface.capabilities.length === 0) {
      issues.push('Missing capabilities');
      ambiguityPoints++;
    }

    if (!surface.manifest?.stateSchema) {
      issues.push('Missing state schema');
      ambiguityPoints++;
    }

    if (!surface.name || surface.name.length < 3) {
      issues.push('Vague or missing surface name');
      ambiguityPoints++;
    }

    if (!surface.manifest || !surface.manifest.metadata?.description || (surface.manifest.metadata.description as string).length < 10) {
      issues.push('Vague or missing surface description');
      ambiguityPoints++;
    }

    const score = Math.min(ambiguityPoints / maxPoints, 1);
    return { score, issues };
  }

  recoverSurface(id: string, name: string, hints: Record<string, unknown>): Surface {
    const inferred = this.inferCapabilities({
      actions: (hints.actions as string[]) ?? [],
      endpoints: (hints.endpoints as string[]) ?? [],
      uiElements: (hints.uiElements as string[]) ?? [],
      cliCommands: (hints.cliCommands as string[]) ?? [],
    });

    const manifest: SurfaceManifest = {
      surfaceId: id,
      version: '1.0.0',
      capabilities: inferred,
      metadata: {
        recovered: true,
        recoveredAt: Date.now(),
        inferredCapabilityCount: inferred.length,
        averageConfidence:
          inferred.length > 0
            ? inferred.reduce((sum, c) => sum + c.confidence, 0) / inferred.length
            : 0,
      },
    };

    const surface: Surface = {
      id,
      name,
      type: 'custom',
      version: '1.0.0',
      capabilities: inferred,
      manifest,
    };

    return surface;
  }

  private classifyAction(name: string): {
    riskLevel: RiskLevel;
    confidence: number;
    category: string;
  } {
    const nameLower = name.toLowerCase();

    for (const pattern of RISK_PATTERNS) {
      for (const keyword of pattern.keywords) {
        if (nameLower.includes(keyword)) {
          // Exact start match = high confidence, substring match = lower
          const confidence = nameLower.startsWith(keyword) ? 0.9 : 0.7;
          return {
            riskLevel: pattern.riskLevel,
            confidence,
            category: pattern.category,
          };
        }
      }
    }

    // No pattern matched — unknown action
    return { riskLevel: 'medium', confidence: 0.3, category: 'unknown' };
  }
}
