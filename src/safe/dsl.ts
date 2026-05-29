export type PolicyVerdict = 'allow' | 'warn' | 'require_approval' | 'deny';

export interface DSLCondition {
  field: string;
  operator: string;
  value: string | number;
}

export interface DSLRule {
  id: string;
  verdict: PolicyVerdict;
  conditions: DSLCondition[];
  logic: 'and' | 'or';
  description: string;
  raw: string;
}

export interface DSLContext {
  action: string;
  surface: { id: string; name: string; type: string };
  actor: { id: string; name: string; trust: string; type: string };
  params: Record<string, unknown>;
  risk: { level: string; score: number };
  [key: string]: unknown;
}

const VERDICT_MAP: Record<string, PolicyVerdict> = {
  ALLOW: 'allow',
  DENY: 'deny',
  WARN: 'warn',
  REQUIRE_APPROVAL: 'require_approval',
};

const VERDICT_SEVERITY: Record<PolicyVerdict, number> = {
  allow: 0,
  warn: 1,
  require_approval: 2,
  deny: 3,
};

const OPERATORS = ['MATCHES', 'CONTAINS', '==', '!=', '>=', '<=', '>', '<', 'IN'];

/** Maximum rules per policy expression (DoS prevention). */
const MAX_RULES = 500;
/** Maximum conditions per rule. */
const MAX_CONDITIONS = 100;
/** Maximum expression length in characters. */
const MAX_EXPRESSION_LENGTH = 10_000;

let ruleCounter = 0;

export class PolicyDSL {
  parse(expression: string): DSLRule {
    const trimmed = expression.trim();
    const tokens = this.tokenize(trimmed);

    if (tokens.length < 4) {
      throw new Error(`Invalid DSL expression: "${trimmed}"`);
    }

    const verdictToken = tokens[0];
    const verdict = VERDICT_MAP[verdictToken];
    if (!verdict) {
      throw new Error(`Unknown verdict: "${verdictToken}". Expected one of: ${Object.keys(VERDICT_MAP).join(', ')}`);
    }

    if (tokens[1] !== 'WHEN') {
      throw new Error(`Expected "WHEN" after verdict, got "${tokens[1]}"`);
    }

    const conditionTokens = tokens.slice(2);
    const conditions: DSLCondition[] = [];
    let logic: 'and' | 'or' = 'and';
    let logicSet = false;

    let i = 0;
    while (i < conditionTokens.length) {
      // Parse one condition: field OPERATOR value
      if (i + 2 >= conditionTokens.length) {
        throw new Error(`Incomplete condition starting at "${conditionTokens[i]}"`);
      }

      const condition = this.parseCondition(conditionTokens.slice(i, i + 3));
      conditions.push(condition);
      i += 3;

      // Check for AND/OR
      if (i < conditionTokens.length) {
        const connector = conditionTokens[i];
        if (connector === 'AND' || connector === 'OR') {
          const currentLogic = connector.toLowerCase() as 'and' | 'or';
          if (logicSet && logic !== currentLogic) {
            throw new Error('Cannot mix AND and OR in a single rule. Use separate rules instead.');
          }
          logic = currentLogic;
          logicSet = true;
          i++;
        } else {
          throw new Error(`Expected AND/OR or end of expression, got "${connector}"`);
        }
      }
    }

    if (conditions.length === 0) {
      throw new Error('Rule must have at least one condition');
    }

    if (conditions.length > MAX_CONDITIONS) {
      throw new Error(`Too many conditions: ${conditions.length} (max ${MAX_CONDITIONS} per rule).`);
    }

    ruleCounter++;

    return {
      id: `rule_${ruleCounter}`,
      verdict,
      conditions,
      logic,
      description: trimmed,
      raw: trimmed,
    };
  }

  parseMultiple(expressions: string): DSLRule[] {
    if (expressions.length > MAX_EXPRESSION_LENGTH) {
      throw new Error(`Policy expression too long: ${expressions.length} chars (max ${MAX_EXPRESSION_LENGTH}).`);
    }

    const lines = expressions.split('\n');
    const rules: DSLRule[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        continue;
      }
      if (rules.length >= MAX_RULES) {
        throw new Error(`Too many rules: maximum ${MAX_RULES} rules per policy expression.`);
      }
      rules.push(this.parse(trimmed));
    }

    return rules;
  }

  evaluate(rule: DSLRule, context: DSLContext): boolean {
    if (rule.conditions.length === 0) return false;

    if (rule.logic === 'and') {
      return rule.conditions.every((cond) => this.evaluateCondition(cond, context));
    } else {
      return rule.conditions.some((cond) => this.evaluateCondition(cond, context));
    }
  }

  evaluateAll(
    rules: DSLRule[],
    context: DSLContext,
  ): { verdict: PolicyVerdict; matchedRules: DSLRule[] } {
    const matchedRules: DSLRule[] = [];

    for (const rule of rules) {
      if (this.evaluate(rule, context)) {
        matchedRules.push(rule);
      }
    }

    if (matchedRules.length === 0) {
      return { verdict: 'allow', matchedRules: [] };
    }

    let highestVerdict: PolicyVerdict = 'allow';
    for (const rule of matchedRules) {
      if (VERDICT_SEVERITY[rule.verdict] > VERDICT_SEVERITY[highestVerdict]) {
        highestVerdict = rule.verdict;
      }
    }

    return { verdict: highestVerdict, matchedRules };
  }

  toFunction(rule: DSLRule): (context: DSLContext) => boolean {
    return (context: DSLContext) => this.evaluate(rule, context);
  }

  private tokenize(expression: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < expression.length; i++) {
      const ch = expression[i];

      if (inQuotes) {
        if (ch === quoteChar) {
          inQuotes = false;
          tokens.push(current);
          current = '';
        } else {
          current += ch;
        }
      } else if (ch === '"' || ch === "'") {
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
        inQuotes = true;
        quoteChar = ch;
      } else if (ch === ' ' || ch === '\t') {
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += ch;
      }
    }

    if (current.length > 0) {
      tokens.push(current);
    }

    return tokens;
  }

  private parseCondition(tokens: string[]): DSLCondition {
    const [field, operator, rawValue] = tokens;

    if (!OPERATORS.includes(operator)) {
      throw new Error(`Unknown operator "${operator}". Supported: ${OPERATORS.join(', ')}`);
    }

    let value: string | number = rawValue;
    const numVal = Number(rawValue);
    if (!isNaN(numVal) && rawValue !== '') {
      value = numVal;
    }

    // Validate condition count per rule (done at evaluate-time via conditions array length)

    return { field, operator, value };
  }

  private evaluateCondition(condition: DSLCondition, context: DSLContext): boolean {
    const actual = this.resolveField(context, condition.field);
    return this.compareValues(actual, condition.operator, condition.value);
  }

  private resolveField(context: DSLContext, field: string): unknown {
    if (field === 'params') {
      return JSON.stringify(context.params);
    }

    // Split on '.' or array index notation like users[0]
    const parts = field.split(/(?:\.|(?=\[))/);
    let current: unknown = context;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;

      // Handle bare bracket index: [0] when current is already an array
      const bareIdxMatch = part.match(/^\[(\d+)\]$/);
      if (bareIdxMatch && Array.isArray(current)) {
        const idx = parseInt(bareIdxMatch[1], 10);
        if (idx < 0 || idx >= current.length) return undefined;
        current = current[idx];
        continue;
      }

      // Check for array index notation: name[0]
      const arrayMatch = part.match(/^(.+?)\[(\d+)\]$/);
      if (arrayMatch) {
        const objKey = arrayMatch[1];
        const arrIndex = parseInt(arrayMatch[2], 10);

        if (typeof current !== 'object') return undefined;
        const obj = (current as Record<string, unknown>)[objKey];
        if (!Array.isArray(obj)) return undefined;
        current = obj[arrIndex];
        continue;
      }

      if (typeof current === 'object') {
        if (Array.isArray(current)) {
          const idx = parseInt(part, 10);
          if (isNaN(idx) || idx < 0 || idx >= current.length) return undefined;
          current = current[idx];
        } else {
          current = (current as Record<string, unknown>)[part];
        }
      } else {
        return undefined;
      }
    }

    return current;
  }

  private matchGlob(value: string, pattern: string): boolean {
    let regexStr = '^';
    for (const ch of pattern) {
      if (ch === '*') {
        regexStr += '.*';
      } else if (ch === '?') {
        regexStr += '.';
      } else {
        regexStr += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
    }
    regexStr += '$';
    return new RegExp(regexStr).test(value);
  }

  private compareValues(actual: unknown, operator: string, expected: string | number): boolean {
    switch (operator) {
      case 'MATCHES': {
        const strActual = String(actual ?? '');
        return this.matchGlob(strActual, String(expected));
      }
      case 'CONTAINS': {
        const strActual = String(actual ?? '');
        return strActual.includes(String(expected));
      }
      case '==': {
        if (typeof expected === 'number') {
          return Number(actual) === expected;
        }
        return String(actual) === String(expected);
      }
      case '!=': {
        if (typeof expected === 'number') {
          return Number(actual) !== expected;
        }
        return String(actual) !== String(expected);
      }
      case '>':
        return Number(actual) > Number(expected);
      case '>=':
        return Number(actual) >= Number(expected);
      case '<':
        return Number(actual) < Number(expected);
      case '<=':
        return Number(actual) <= Number(expected);
      case 'IN': {
        const list = String(expected).split(',').map((s) => s.trim());
        return list.includes(String(actual));
      }
      default:
        return false;
    }
  }
}
