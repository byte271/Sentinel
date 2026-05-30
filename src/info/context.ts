// ---------------------------------------------------------------------------
// SENTINEL Context Guardian (Feature 4)
// ---------------------------------------------------------------------------
// Long-running agents degrade as their context window fills with stale, noisy,
// or untrusted content — and critical early instructions get "lost in the
// middle". The Context Guardian actively monitors context health and gives the
// agent the tools to stay focused:
//
//   - Token-budget tracking with a configurable auto-compaction threshold.
//   - Context entropy / pollution scoring (repetition + untrusted ratio).
//   - "Lost in the middle" detection for pinned critical instructions.
//   - Provenance tagging — every chunk carries a source, freshness, and trust.
//   - Injection boundary marking — web/tool content is explicitly untrusted.
//   - Compaction that evicts low-trust, stale, unpinned chunks first while
//     always preserving pinned constraints.
//
// Pure and dependency-free; the token estimator is pluggable.
// ---------------------------------------------------------------------------

/** Trust-bearing origin of a context chunk. Web/tool content is untrusted. */
export type ContextSource = 'system' | 'user' | 'agent' | 'tool' | 'web' | 'memory' | 'unknown';

export interface ContextChunk {
  id: string;
  content: string;
  tokens: number;
  source: ContextSource;
  /** 0–1 trust score derived from the source unless overridden. */
  trust: number;
  /** Whether this content originated outside the trust boundary. */
  untrusted: boolean;
  /** Pinned chunks (critical constraints) are never evicted by compaction. */
  pinned: boolean;
  addedAt: number;
  /** Insertion order (0 = oldest / earliest in the window). */
  position: number;
}

export interface ContextHealth {
  chunkCount: number;
  totalTokens: number;
  budget: number;
  /** totalTokens / budget. */
  utilization: number;
  /** Normalized Shannon entropy of token distribution, 0–1 (low = repetitive). */
  entropy: number;
  /** 0–100 pollution score (higher = more polluted). */
  pollutionScore: number;
  /** Fraction of tokens that came from untrusted sources. */
  untrustedRatio: number;
  /** True when a pinned critical instruction has drifted into the middle. */
  lostInMiddleRisk: boolean;
  /** True when the context should be compacted now. */
  shouldCompact: boolean;
  alerts: string[];
}

export interface AddOptions {
  source?: ContextSource;
  trust?: number;
  pinned?: boolean;
  untrusted?: boolean;
  at?: number;
}

export interface ContextGuardianOptions {
  /** Token budget before compaction is advised. Default: 30000. */
  tokenBudget?: number;
  /** Fraction of budget at which to warn (default 0.75). */
  warnThreshold?: number;
  /** Target utilization to compact down to (default 0.6). */
  compactTarget?: number;
  /** Token estimator (default: ~4 chars/token). */
  tokenizer?: (content: string) => number;
}

const SOURCE_TRUST: Record<ContextSource, number> = {
  system: 1.0,
  user: 1.0,
  agent: 0.85,
  memory: 0.8,
  tool: 0.5,
  web: 0.3,
  unknown: 0.5,
};

const UNTRUSTED_SOURCES: ReadonlySet<ContextSource> = new Set<ContextSource>(['web', 'tool']);

let counter = 0;

export class ContextGuardian {
  private chunks: ContextChunk[] = [];
  private readonly budget: number;
  private readonly warnThreshold: number;
  private readonly compactTarget: number;
  private readonly tokenizer: (content: string) => number;

  constructor(options: ContextGuardianOptions = {}) {
    this.budget = options.tokenBudget ?? 30_000;
    this.warnThreshold = options.warnThreshold ?? 0.75;
    this.compactTarget = options.compactTarget ?? 0.6;
    this.tokenizer = options.tokenizer ?? ((c) => Math.max(1, Math.ceil(c.length / 4)));
  }

  /** Add a chunk of context. Returns the created chunk. */
  add(content: string, options: AddOptions = {}): ContextChunk {
    const source = options.source ?? 'unknown';
    const untrusted = options.untrusted ?? UNTRUSTED_SOURCES.has(source);
    const trust = options.trust ?? (untrusted ? Math.min(SOURCE_TRUST[source], 0.4) : SOURCE_TRUST[source]);
    const chunk: ContextChunk = {
      id: `ctx-${(counter++).toString(36)}`,
      content,
      tokens: this.tokenizer(content),
      source,
      trust,
      untrusted,
      pinned: options.pinned ?? false,
      addedAt: options.at ?? Date.now(),
      position: this.chunks.length,
    };
    this.chunks.push(chunk);
    return chunk;
  }

  /**
   * Add untrusted external content with an explicit injection boundary marker
   * wrapped around it, so downstream consumers can see where the trust boundary
   * is even if the chunks are later flattened into a single string.
   */
  addUntrusted(content: string, source: ContextSource = 'web', options: AddOptions = {}): ContextChunk {
    const marked = `<<UNTRUSTED:${source}>>\n${content}\n<</UNTRUSTED>>`;
    return this.add(marked, { ...options, source, untrusted: true });
  }

  /** Pin a chunk so compaction never evicts it (critical constraints). */
  pin(id: string): boolean {
    const c = this.chunks.find((x) => x.id === id);
    if (!c) return false;
    c.pinned = true;
    return true;
  }

  /** The contents of all pinned critical constraints (for re-injection). */
  criticalConstraints(): string[] {
    return this.chunks.filter((c) => c.pinned).map((c) => c.content);
  }

  totalTokens(): number {
    return this.chunks.reduce((sum, c) => sum + c.tokens, 0);
  }

  list(): ContextChunk[] {
    return [...this.chunks];
  }

  /** Compute a full health report for the current context window. */
  health(now: number = Date.now()): ContextHealth {
    const totalTokens = this.totalTokens();
    const utilization = totalTokens / this.budget;
    const untrustedTokens = this.chunks.filter((c) => c.untrusted).reduce((s, c) => s + c.tokens, 0);
    const untrustedRatio = totalTokens > 0 ? untrustedTokens / totalTokens : 0;
    const entropy = this.computeEntropy();
    const repetition = 1 - entropy;
    const overflow = Math.max(0, utilization - 1);
    const pollutionScore = Math.round(
      Math.min(100, 50 * untrustedRatio + 30 * repetition + 20 * Math.min(1, overflow)),
    );
    const lostInMiddleRisk = this.detectLostInMiddle(totalTokens);
    const shouldCompact = utilization >= 1 || (utilization >= this.warnThreshold && pollutionScore >= 60);

    const alerts: string[] = [];
    if (utilization >= this.warnThreshold) {
      alerts.push(`Context at ${(utilization * 100).toFixed(0)}% of budget (${totalTokens}/${this.budget} tokens).`);
    }
    if (untrustedRatio >= 0.4) {
      alerts.push(`Untrusted content is ${(untrustedRatio * 100).toFixed(0)}% of context — injection risk elevated.`);
    }
    if (repetition >= 0.6) {
      alerts.push('High repetition detected — context may be polluted/looping.');
    }
    if (lostInMiddleRisk) {
      alerts.push('Critical pinned instruction has drifted into the middle of the window ("lost in the middle").');
    }
    if (shouldCompact) {
      alerts.push('Compaction recommended.');
    }

    return {
      chunkCount: this.chunks.length,
      totalTokens,
      budget: this.budget,
      utilization,
      entropy,
      pollutionScore,
      untrustedRatio,
      lostInMiddleRisk,
      shouldCompact,
      alerts,
    };
  }

  /**
   * Evict low-trust, stale, unpinned chunks until the context is at or below
   * the compaction target. Pinned constraints are always preserved and, if
   * they had drifted, are moved to the end so they stay in the attention
   * window. Returns the evicted chunks.
   */
  compact(now: number = Date.now()): { removed: ContextChunk[]; freedTokens: number } {
    const target = this.budget * this.compactTarget;
    const removable = this.chunks
      .filter((c) => !c.pinned)
      // Lowest trust first, then oldest first.
      .sort((a, b) => (a.trust - b.trust) || (a.addedAt - b.addedAt));

    const removed: ContextChunk[] = [];
    let total = this.totalTokens();
    for (const chunk of removable) {
      if (total <= target) break;
      removed.push(chunk);
      total -= chunk.tokens;
    }

    const removedIds = new Set(removed.map((c) => c.id));
    const survivors = this.chunks.filter((c) => !removedIds.has(c.id));

    // Re-anchor pinned constraints at the end so they remain salient.
    const pinned = survivors.filter((c) => c.pinned);
    const rest = survivors.filter((c) => !c.pinned);
    this.chunks = [...rest, ...pinned];
    this.chunks.forEach((c, i) => { c.position = i; });

    return { removed, freedTokens: removed.reduce((s, c) => s + c.tokens, 0) };
  }

  // ---- internals ----------------------------------------------------------

  /** Normalized Shannon entropy over word frequencies (0 = uniform repetition, 1 = diverse). */
  private computeEntropy(): number {
    const words = this.chunks
      .map((c) => c.content.toLowerCase())
      .join(' ')
      .match(/[a-z0-9]+/g);
    if (!words || words.length === 0) return 1;
    const freq = new Map<string, number>();
    for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
    const n = words.length;
    let h = 0;
    for (const count of freq.values()) {
      const pmf = count / n;
      h -= pmf * Math.log2(pmf);
    }
    const unique = freq.size;
    if (unique <= 1) return 0;
    return h / Math.log2(unique); // normalize to [0,1]
  }

  private detectLostInMiddle(totalTokens: number): boolean {
    if (this.chunks.length < 3 || totalTokens < this.budget * 0.5) return false;
    const n = this.chunks.length;
    return this.chunks.some((c) => {
      if (!c.pinned) return false;
      const p = c.position / (n - 1);
      return p >= 0.2 && p <= 0.8;
    });
  }
}
