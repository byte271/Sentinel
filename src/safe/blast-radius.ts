import { v4 as uuid } from 'uuid';
import type { ActionIntent, Surface } from '../kernel/types.js';

export interface BlastNode {
  id: string;
  type: 'resource' | 'surface' | 'actor' | 'external';
  name: string;
  impact: 'direct' | 'transitive';
  riskLevel: string;
}

export interface BlastEdge {
  from: string;
  to: string;
  relationship: 'modifies' | 'depends_on' | 'triggers' | 'notifies';
}

export interface BlastRadius {
  intentId: string;
  nodes: BlastNode[];
  edges: BlastEdge[];
  directImpact: number;
  transitiveImpact: number;
  maxDepth: number;
  riskAmplification: number;
  summary: string;
}

export interface SurfaceDependency {
  fromSurface: string;
  toSurface: string;
  relationship: BlastEdge['relationship'];
  description: string;
}

export class BlastRadiusAnalyzer {
  private dependencies: SurfaceDependency[] = [];
  private surfaceResources: Map<string, Array<{ id: string; name: string; type: string }>> = new Map();

  /**
   * Forward adjacency: fromSurface → outgoing deps.
   * Replaces O(n) filter scans in the BFS inner loop.
   */
  private readonly adjacency: Map<string, SurfaceDependency[]> = new Map();

  /**
   * Reverse adjacency: toSurface → incoming deps.
   * Enables O(1) linkingDep lookup during BFS node rendering.
   */
  private readonly reverseAdjacency: Map<string, SurfaceDependency[]> = new Map();

  registerDependency(dep: SurfaceDependency): void {
    this.dependencies.push(dep);

    // Forward index: fromSurface → outgoing deps
    const fwd = this.adjacency.get(dep.fromSurface) ?? [];
    fwd.push(dep);
    this.adjacency.set(dep.fromSurface, fwd);

    // Reverse index: toSurface → incoming deps
    const rev = this.reverseAdjacency.get(dep.toSurface) ?? [];
    rev.push(dep);
    this.reverseAdjacency.set(dep.toSurface, rev);
  }

  registerResource(surfaceId: string, resource: { id: string; name: string; type: string }): void {
    const resources = this.surfaceResources.get(surfaceId) ?? [];
    resources.push(resource);
    this.surfaceResources.set(surfaceId, resources);
  }

  /**
   * Analyze blast radius for an action intent on a surface.
   * Supports two signatures:
   *   - (intent, surface) — high-level
   *   - (intentId, surfaceId, action, params, capabilities?) — low-level
   */
  analyze(intent: ActionIntent, surface: Surface): BlastRadius;
  analyze(intentId: string, surfaceId: string, action: string, params: Record<string, unknown>, surfaceCapabilities?: Array<{ action: string; riskLevel: string }>): BlastRadius;
  analyze(
    intentOrId: ActionIntent | string,
    surfaceOrId: Surface | string,
    action?: string,
    params?: Record<string, unknown>,
    surfaceCapabilities?: Array<{ action: string; riskLevel: string }>,
  ): BlastRadius {
    if (typeof intentOrId === 'object' && 'id' in intentOrId && 'action' in intentOrId) {
      const intent = intentOrId as ActionIntent;
      const surface = surfaceOrId as Surface;
      return this._analyze(
        intent.id,
        surface.id,
        intent.action,
        intent.params,
        surface.capabilities?.map(c => ({ action: c.action, riskLevel: c.riskLevel })),
      );
    }
    return this._analyze(
      intentOrId as string,
      surfaceOrId as string,
      action!,
      params ?? {},
      surfaceCapabilities,
    );
  }

  private _analyze(
    intentId: string,
    surfaceId: string,
    action: string,
    params: Record<string, unknown>,
    surfaceCapabilities?: Array<{ action: string; riskLevel: string }>
  ): BlastRadius {
    const nodes: BlastNode[] = [];
    const edges: BlastEdge[] = [];
    const visited = new Set<string>();

    // Determine risk level for the action from capabilities
    const capability = surfaceCapabilities?.find((c) => c.action === action);
    const actionRiskLevel = capability?.riskLevel ?? 'medium';

    // 1. Add the target resource as root node
    const resourceName = (params.path ?? params.name ?? params.target ?? 'unknown') as string;
    const rootResourceId = uuid();
    nodes.push({
      id: rootResourceId,
      type: 'resource',
      name: resourceName,
      impact: 'direct',
      riskLevel: actionRiskLevel,
    });

    // 2. Add the surface as a direct-impact node
    const surfaceNodeId = uuid();
    nodes.push({
      id: surfaceNodeId,
      type: 'surface',
      name: surfaceId,
      impact: 'direct',
      riskLevel: actionRiskLevel,
    });

    edges.push({
      from: surfaceNodeId,
      to: rootResourceId,
      relationship: 'modifies',
    });

    visited.add(surfaceId);

    // 3. BFS to traverse dependency graph with cycle detection
    const queue: Array<{ surface: string; parentNodeId: string; depth: number; parentRisk: string }> = [];
    let maxDepth = 0;

    // Seed BFS with direct dependencies of the source surface — O(1) with index.
    const directDeps = this.adjacency.get(surfaceId) ?? [];
    for (const dep of directDeps) {
      if (!visited.has(dep.toSurface)) {
        queue.push({
          surface: dep.toSurface,
          parentNodeId: surfaceNodeId,
          depth: 1,
          parentRisk: actionRiskLevel,
        });
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.surface)) continue;
      visited.add(current.surface);

      if (current.depth > maxDepth) {
        maxDepth = current.depth;
      }

      // Risk propagation: downstream is at least 'medium' if source is 'high'
      const propagatedRisk = this.propagateRisk(current.parentRisk);

      // Add the transitive surface node
      const transitiveNodeId = uuid();
      nodes.push({
        id: transitiveNodeId,
        type: 'surface',
        name: current.surface,
        impact: 'transitive',
        riskLevel: propagatedRisk,
      });

      // Find the linking dependency via reverse index — O(1) instead of O(deps).
      const incomingDeps = this.reverseAdjacency.get(current.surface) ?? [];
      const linkingDep = incomingDeps.find((d) => visited.has(d.fromSurface));
      edges.push({
        from: current.parentNodeId,
        to: transitiveNodeId,
        relationship: linkingDep?.relationship ?? 'triggers',
      });

      // 4. Add resources of this transitive surface as transitive-impact nodes
      const resources = this.surfaceResources.get(current.surface) ?? [];
      for (const res of resources) {
        const resNodeId = uuid();
        nodes.push({
          id: resNodeId,
          type: 'resource',
          name: res.name,
          impact: 'transitive',
          riskLevel: propagatedRisk,
        });
        edges.push({
          from: transitiveNodeId,
          to: resNodeId,
          relationship: 'triggers',
        });
      }

      // Continue BFS — O(1) forward lookup with adjacency map.
      const nextDeps = this.adjacency.get(current.surface) ?? [];
      for (const dep of nextDeps) {
        if (!visited.has(dep.toSurface)) {
          queue.push({
            surface: dep.toSurface,
            parentNodeId: transitiveNodeId,
            depth: current.depth + 1,
            parentRisk: propagatedRisk,
          });
        }
      }
    }

    const directImpact = nodes.filter((n) => n.impact === 'direct').length;
    const transitiveImpact = nodes.filter((n) => n.impact === 'transitive').length;
    const riskAmplification = 1 + transitiveImpact * 0.2;

    const summary =
      `Action "${action}" on ${surfaceId} affects ${directImpact} direct ` +
      `and ${transitiveImpact} transitive nodes. ` +
      `Risk amplification: ${riskAmplification.toFixed(1)}x, max depth: ${maxDepth}.`;

    return {
      intentId,
      nodes,
      edges,
      directImpact,
      transitiveImpact,
      maxDepth,
      riskAmplification,
      summary,
    };
  }

  visualize(radius: BlastRadius): string {
    const lines: string[] = [];

    // Find root resource (first direct resource node)
    const rootResource = radius.nodes.find((n) => n.type === 'resource' && n.impact === 'direct');
    const rootSurface = radius.nodes.find((n) => n.type === 'surface' && n.impact === 'direct');

    if (!rootResource || !rootSurface) {
      return '(empty blast radius)';
    }

    // Header: action + resource
    lines.push(`[${rootSurface.name}] ${rootResource.name}`);

    // Build a tree structure from edges
    const childMap = new Map<string, string[]>();
    for (const edge of radius.edges) {
      const children = childMap.get(edge.from) ?? [];
      children.push(edge.to);
      childMap.set(edge.from, children);
    }

    const nodeMap = new Map<string, BlastNode>();
    for (const node of radius.nodes) {
      nodeMap.set(node.id, node);
    }

    // Recursive tree renderer
    const renderChildren = (parentId: string, prefix: string): void => {
      const children = childMap.get(parentId) ?? [];
      for (let i = 0; i < children.length; i++) {
        const childId = children[i];
        const child = nodeMap.get(childId);
        if (!child) continue;

        const isLast = i === children.length - 1;
        const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ';
        const nextPrefix = isLast ? prefix + '    ' : prefix + '\u2502   ';

        if (child.type === 'surface') {
          lines.push(`${prefix}${connector}${child.name} (${child.impact}, ${child.riskLevel})`);
          renderChildren(childId, nextPrefix);
        } else if (child.type === 'resource') {
          const edge = radius.edges.find((e) => e.to === childId);
          const rel = edge?.relationship ?? 'affected';
          lines.push(`${prefix}${connector}${child.name} (resource, ${rel})`);
          renderChildren(childId, nextPrefix);
        } else {
          lines.push(`${prefix}${connector}${child.name} (${child.type}, ${child.impact})`);
          renderChildren(childId, nextPrefix);
        }
      }
    };

    // Start rendering from the surface node
    renderChildren(rootSurface.id, '');

    // Summary line
    lines.push(
      `\u2514\u2500\u2500 Summary: ${radius.directImpact} direct, ` +
        `${radius.transitiveImpact} transitive, ` +
        `amplification: ${radius.riskAmplification.toFixed(1)}x`
    );

    return lines.join('\n');
  }

  getReport(intentId: string, radius: BlastRadius): string {
    const lines: string[] = [];

    lines.push('='.repeat(60));
    lines.push(`BLAST RADIUS REPORT`);
    lines.push(`Intent: ${intentId}`);
    lines.push('='.repeat(60));
    lines.push('');

    lines.push('--- Impact Summary ---');
    lines.push(`Direct impact:     ${radius.directImpact} node(s)`);
    lines.push(`Transitive impact: ${radius.transitiveImpact} node(s)`);
    lines.push(`Max depth:         ${radius.maxDepth}`);
    lines.push(`Risk amplification: ${radius.riskAmplification.toFixed(1)}x`);
    lines.push('');

    lines.push('--- Nodes ---');
    for (const node of radius.nodes) {
      lines.push(
        `  [${node.type}] ${node.name} | impact: ${node.impact} | risk: ${node.riskLevel}`
      );
    }
    lines.push('');

    lines.push('--- Edges ---');
    const nodeMap = new Map<string, BlastNode>();
    for (const node of radius.nodes) {
      nodeMap.set(node.id, node);
    }
    for (const edge of radius.edges) {
      const fromName = nodeMap.get(edge.from)?.name ?? edge.from;
      const toName = nodeMap.get(edge.to)?.name ?? edge.to;
      lines.push(`  ${fromName} --[${edge.relationship}]--> ${toName}`);
    }
    lines.push('');

    lines.push('--- Visualization ---');
    lines.push(this.visualize(radius));
    lines.push('');

    lines.push('--- Summary ---');
    lines.push(radius.summary);
    lines.push('='.repeat(60));

    return lines.join('\n');
  }

  private propagateRisk(parentRisk: string): string {
    switch (parentRisk) {
      case 'critical':
        return 'high';
      case 'high':
        return 'medium';
      case 'medium':
        return 'low';
      case 'low':
        return 'low';
      default:
        return 'low';
    }
  }
}
