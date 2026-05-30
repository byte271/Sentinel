// ---------------------------------------------------------------------------
// SENTINEL Agent Firewall (Feature 1)
// ---------------------------------------------------------------------------
// A deterministic, framework-agnostic firewall for AI tool calls. It scans the
// tool name, its arguments, and any free-form text (e.g. model output or a
// fetched web page) BEFORE execution and returns a verdict — allow / warn /
// block — together with the patterns that matched and a 0–100 risk score.
//
// Design goals:
//   - Deterministic. Pure pattern matching, never an LLM-as-judge: instant,
//     reproducible, and free of hallucinations.
//   - Framework-agnostic. The `ToolCall` shape is intentionally minimal so it
//     can wrap LangChain, the OpenAI Agents SDK, custom loops, etc.
//   - Extensible. Ships with a curated built-in ruleset and accepts custom
//     rules as plain JSON (so non-TS users can extend it).
//
// It is dependency-free and self-contained, mirroring the rest of the codebase.
// ---------------------------------------------------------------------------

import type { RiskLevel } from '../kernel/types.js';

/** Firewall verdict for a scanned tool call. */
export type FirewallVerdict = 'allow' | 'warn' | 'block';

/** The class of threat a detection pattern targets. */
export type FirewallCategory =
  | 'injection'
  | 'exfiltration'
  | 'privilege-escalation'
  | 'credential-access'
  | 'destructive'
  | 'persistence'
  | 'custom';

/**
 * Policy presets controlling how aggressively the firewall blocks. A match at
 * or above the policy's block threshold becomes a `block`; a match below it
 * (but at least `low`) becomes a `warn`.
 */
export type FirewallPolicy = 'strict' | 'balanced' | 'permissive';

/** A single deterministic detection rule. */
export interface DetectionPattern {
  id: string;
  category: FirewallCategory;
  severity: RiskLevel;
  description: string;
  /** The compiled matcher. */
  pattern: RegExp;
}

/** JSON-serializable form of a detection pattern (for custom rule files). */
export interface DetectionPatternSpec {
  id: string;
  category: FirewallCategory;
  severity: RiskLevel;
  description: string;
  /** Regex source string. */
  pattern: string;
  /** Optional regex flags (default: 'i'). */
  flags?: string;
}

/** A tool call presented to the firewall for inspection. */
export interface ToolCall {
  /** The tool / function / action name (e.g. 'shell', 'http.post', 'fs.write'). */
  tool: string;
  /** Structured arguments, if any. */
  args?: Record<string, unknown>;
  /** Free-form text associated with the call (model output, fetched content). */
  text?: string;
}

/** A pattern that fired during a scan. */
export interface PatternMatch {
  patternId: string;
  category: FirewallCategory;
  severity: RiskLevel;
  description: string;
  /** The matched substring (truncated) — the evidence for the decision. */
  evidence: string;
}

/** The outcome of scanning a single tool call. */
export interface FirewallResult {
  verdict: FirewallVerdict;
  /** Highest matched severity, or 'none' when nothing matched. */
  risk: RiskLevel;
  /** 0–100 risk score (max over matches). */
  score: number;
  matches: PatternMatch[];
  /** Wall-clock scan time in milliseconds. */
  latencyMs: number;
  policy: FirewallPolicy;
}

const SEVERITY_SCORE: Record<RiskLevel, number> = {
  none: 0,
  low: 25,
  medium: 50,
  high: 80,
  critical: 100,
};

const SEVERITY_RANK: Record<RiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Minimum severity rank that triggers a hard block, per policy. */
const BLOCK_THRESHOLD: Record<FirewallPolicy, number> = {
  strict: SEVERITY_RANK.medium, // block medium and above
  balanced: SEVERITY_RANK.high, // block high and above
  permissive: SEVERITY_RANK.critical, // block only critical
};

/** Cap on evidence length recorded per match (keeps results compact). */
const MAX_EVIDENCE = 120;

// ---------------------------------------------------------------------------
// Built-in detection patterns — a curated, deterministic ruleset.
// ---------------------------------------------------------------------------

const p = (
  id: string,
  category: FirewallCategory,
  severity: RiskLevel,
  description: string,
  pattern: RegExp,
): DetectionPattern => ({ id, category, severity, description, pattern });

export const BUILTIN_PATTERNS: DetectionPattern[] = [
  // -- Prompt injection -----------------------------------------------------
  p('inj-ignore-previous', 'injection', 'high', 'Attempt to override prior instructions',
    /\b(ignore|disregard|forget)\b[\s\S]{0,40}\b(previous|prior|above|earlier|all)\b[\s\S]{0,20}\b(instruction|prompt|rule|context)/i),
  p('inj-new-instructions', 'injection', 'high', 'Injected replacement instructions',
    /\b(new|updated|real|actual)\s+(instruction|directive|system\s+prompt)s?\b\s*[:\-]/i),
  p('inj-you-are-now', 'injection', 'medium', 'Persona / role reassignment',
    /\byou\s+are\s+now\b|\bfrom\s+now\s+on\s+you\b|\bact\s+as\s+(an?\s+)?(unrestricted|jailbroken|dan)\b/i),
  p('inj-reveal-system-prompt', 'injection', 'high', 'Attempt to exfiltrate the system prompt',
    /\b(reveal|print|show|repeat|output|leak)\b[\s\S]{0,30}\b(system\s+prompt|your\s+instructions|initial\s+prompt)\b/i),
  p('inj-jailbreak-marker', 'injection', 'high', 'Known jailbreak marker',
    /\b(DAN\s+mode|developer\s+mode\s+enabled|do\s+anything\s+now|jailbreak)\b/i),
  p('inj-tool-output-marker', 'injection', 'medium', 'Embedded instruction inside tool/web content',
    /<\s*(system|assistant)\s*>|\[\[\s*system\s*\]\]|###\s*system\s*###/i),

  // -- Credential access ----------------------------------------------------
  p('cred-shadow-passwd', 'credential-access', 'critical', 'Access to system credential files',
    /\/etc\/(shadow|passwd|sudoers)\b/i),
  p('cred-ssh-key', 'credential-access', 'critical', 'Access to SSH private keys',
    /(\.ssh\/(id_(rsa|ed25519|ecdsa|dsa)|authorized_keys)|BEGIN\s+(RSA|OPENSSH|EC|DSA)?\s*PRIVATE\s+KEY)/i),
  p('cred-aws-file', 'credential-access', 'high', 'Access to cloud credential files',
    /(\.aws\/credentials|\.config\/gcloud|\.kube\/config|\.npmrc|\.netrc)\b/i),
  p('cred-dotenv', 'credential-access', 'medium', 'Access to environment/secret files',
    /(^|[\s'"`/])\.env(\.\w+)?\b|\bsecrets?\.(json|ya?ml|toml)\b/i),
  p('cred-aws-access-key', 'credential-access', 'critical', 'AWS access key id in payload',
    /\bAKIA[0-9A-Z]{16}\b/),
  p('cred-bearer-token', 'credential-access', 'high', 'Bearer/API token in payload',
    /\b(bearer\s+[A-Za-z0-9\-_.=]{20,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/i),
  p('cred-env-dump', 'credential-access', 'medium', 'Bulk environment variable dump',
    /\b(printenv|env\s*\||process\.env\b[\s\S]{0,20}(JSON|stringify|Object\.keys))/i),

  // -- Data exfiltration ----------------------------------------------------
  p('exfil-curl-post', 'exfiltration', 'high', 'Outbound data POST via curl/wget',
    /\b(curl|wget|http\.post|fetch)\b[\s\S]{0,80}(-d|--data|--data-binary|body\s*[:=]|-F)\b/i),
  p('exfil-pipe-to-network', 'exfiltration', 'high', 'Piping local data to the network',
    /\b(cat|tar|zip|base64)\b[\s\S]{0,40}\|\s*(curl|wget|nc|netcat|ncat)\b/i),
  p('exfil-reverse-shell', 'exfiltration', 'critical', 'Reverse shell pattern',
    /\b(nc|ncat|netcat)\b[\s\S]{0,30}-e\b|bash\s+-i\s*>&\s*\/dev\/tcp\//i),
  p('exfil-external-webhook', 'exfiltration', 'medium', 'Send to a generic external webhook/paste site',
    /\b(requestbin|webhook\.site|pastebin\.com|hastebin|transfer\.sh|0x0\.st)\b/i),

  // -- Privilege escalation -------------------------------------------------
  p('priv-sudo', 'privilege-escalation', 'high', 'Privilege escalation via sudo/su',
    /\b(sudo|su)\b\s+\S/i),
  p('priv-chmod-world', 'privilege-escalation', 'medium', 'Overly permissive chmod / setuid',
    /\bchmod\s+(-R\s+)?(777|0777|\+s|u\+s|g\+s)\b/i),
  p('priv-iam-modify', 'privilege-escalation', 'high', 'IAM / policy modification',
    /\baws\s+iam\s+(attach|put|create|update)-?\w*|attach-user-policy|create-access-key\b/i),
  p('priv-docker-privileged', 'privilege-escalation', 'high', 'Privileged container escape vector',
    /\bdocker\s+run\b[\s\S]{0,60}(--privileged|-v\s*\/:\/|--pid=host|--net=host)\b/i),

  // -- Destructive ----------------------------------------------------------
  p('destr-rm-rf-root', 'destructive', 'critical', 'Recursive delete of root/home',
    /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+["']?(\/|~|\$HOME)(\s|\*|"|'|$)/i),
  p('destr-fork-bomb', 'destructive', 'critical', 'Fork bomb',
    /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/),
  p('destr-disk-wipe', 'destructive', 'critical', 'Disk overwrite / format',
    /\b(mkfs\.\w+|dd\s+if=\/dev\/(zero|random|urandom)\s+of=\/dev\/|>\s*\/dev\/sd[a-z])\b/i),
  p('destr-sql-drop', 'destructive', 'high', 'Destructive SQL without scope',
    /\b(drop\s+(table|database)|truncate\s+table|delete\s+from\s+\w+\s*;?\s*$)/i),
  p('destr-git-force', 'destructive', 'medium', 'Destructive git/history rewrite',
    /\bgit\s+(push\s+(-f|--force)\b|reset\s+--hard\b|clean\s+-[a-z]*f)/i),

  p('exfil-download-exec', 'exfiltration', 'critical', 'Download piped directly into a shell/interpreter',
    /\b(curl|wget)\b[\s\S]{0,120}\|\s*(sh|bash|zsh|python3?|node|perl|ruby)\b/i),
  p('priv-base64-exec', 'privilege-escalation', 'high', 'Obfuscated payload decoded into a shell',
    /\bbase64\s+(-d|--decode|-D)\b[\s\S]{0,40}\|\s*(sh|bash|zsh)\b|\beval\s*\(\s*atob\s*\(/i),

  // -- Credential access (cont.) -------------------------------------------
  p('cred-history-file', 'credential-access', 'medium', 'Access to shell history files',
    /\.(bash|zsh|sh)_history\b/i),

  // -- Persistence ----------------------------------------------------------
  p('persist-cron', 'persistence', 'medium', 'Persistence via cron/at',
    /\b(crontab\s+-|>\s*\/etc\/cron|at\s+now\b|systemctl\s+enable)\b/i),
  p('persist-shell-profile', 'persistence', 'medium', 'Persistence via shell profile',
    />>\s*(~\/\.(bashrc|zshrc|profile|bash_profile)|\/etc\/profile)/i),
  p('persist-authorized-keys', 'persistence', 'high', 'Backdoor via SSH authorized_keys',
    />>?\s*[\s\S]{0,40}\.ssh\/authorized_keys\b/i),
];

// ---------------------------------------------------------------------------
// AgentFirewall
// ---------------------------------------------------------------------------

export interface AgentFirewallOptions {
  /** Policy preset. Default: 'balanced'. */
  policy?: FirewallPolicy;
  /** Include the built-in ruleset. Default: true. */
  includeBuiltins?: boolean;
  /** Additional patterns to register at construction. */
  patterns?: DetectionPattern[];
}

export class AgentFirewall {
  private patterns = new Map<string, DetectionPattern>();
  private policy: FirewallPolicy;

  constructor(options: AgentFirewallOptions = {}) {
    this.policy = options.policy ?? 'balanced';
    if (options.includeBuiltins !== false) {
      for (const pat of BUILTIN_PATTERNS) this.patterns.set(pat.id, pat);
    }
    for (const pat of options.patterns ?? []) this.patterns.set(pat.id, pat);
  }

  /** Switch the active policy preset. */
  setPolicy(policy: FirewallPolicy): void {
    this.policy = policy;
  }

  getPolicy(): FirewallPolicy {
    return this.policy;
  }

  /** Register or replace a single pattern. */
  addPattern(pattern: DetectionPattern): void {
    this.patterns.set(pattern.id, pattern);
  }

  /** Load custom rules from their JSON-serializable specs. */
  loadPatterns(specs: DetectionPatternSpec[]): void {
    for (const spec of specs) {
      this.patterns.set(spec.id, {
        id: spec.id,
        category: spec.category,
        severity: spec.severity,
        description: spec.description,
        pattern: new RegExp(spec.pattern, spec.flags ?? 'i'),
      });
    }
  }

  removePattern(id: string): boolean {
    return this.patterns.delete(id);
  }

  /** All registered patterns (built-in + custom). */
  listPatterns(): DetectionPattern[] {
    return [...this.patterns.values()];
  }

  get patternCount(): number {
    return this.patterns.size;
  }

  /**
   * Scan a tool call. Returns a verdict, the matched patterns, and a risk
   * score. Pure and deterministic: identical input always yields the same
   * verdict (timing aside).
   */
  scan(call: ToolCall): FirewallResult {
    const start = performance.now();
    const haystack = this.buildHaystack(call);
    const matches: PatternMatch[] = [];

    for (const pat of this.patterns.values()) {
      // Reset lastIndex defensively in case a global flag was supplied.
      pat.pattern.lastIndex = 0;
      const m = pat.pattern.exec(haystack);
      if (m) {
        matches.push({
          patternId: pat.id,
          category: pat.category,
          severity: pat.severity,
          description: pat.description,
          evidence: m[0].slice(0, MAX_EVIDENCE),
        });
      }
    }

    const risk = this.highestSeverity(matches);
    const score = matches.reduce((max, mm) => Math.max(max, SEVERITY_SCORE[mm.severity]), 0);
    const verdict = this.verdictFor(matches);
    const latencyMs = performance.now() - start;

    return { verdict, risk, score, matches, latencyMs, policy: this.policy };
  }

  /** Convenience: true when the call should be allowed to proceed. */
  allows(call: ToolCall): boolean {
    return this.scan(call).verdict !== 'block';
  }

  // ---- internals ----------------------------------------------------------

  private buildHaystack(call: ToolCall): string {
    const parts = [call.tool];
    if (call.args) {
      try {
        parts.push(JSON.stringify(call.args));
      } catch {
        parts.push(String(call.args));
      }
    }
    if (call.text) parts.push(call.text);
    return parts.join('\n');
  }

  private highestSeverity(matches: PatternMatch[]): RiskLevel {
    let rank = 0;
    let level: RiskLevel = 'none';
    for (const m of matches) {
      if (SEVERITY_RANK[m.severity] > rank) {
        rank = SEVERITY_RANK[m.severity];
        level = m.severity;
      }
    }
    return level;
  }

  private verdictFor(matches: PatternMatch[]): FirewallVerdict {
    if (matches.length === 0) return 'allow';
    const top = this.highestSeverity(matches);
    const topRank = SEVERITY_RANK[top];
    if (topRank >= BLOCK_THRESHOLD[this.policy]) return 'block';
    return 'warn';
  }
}
