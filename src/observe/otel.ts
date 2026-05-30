// ---------------------------------------------------------------------------
// SENTINEL Observable Agent Protocol (Feature 12)
// ---------------------------------------------------------------------------
// Every Sentinel component can emit OpenTelemetry-style spans and traces:
// tool calls, model inferences, state mutations, blocked actions, memory
// operations, and inter-agent delegations. Spans export as OTLP-compatible
// JSON that any OTLP backend (Jaeger, Grafana Tempo, Datadog) can ingest.
//
// This is a dependency-free tracer that implements the subset of the
// OpenTelemetry data model needed for agent observability — trace/span ids,
// parent linkage, attributes, events, status, and OTLP resourceSpans export.
// Plug in `@opentelemetry/sdk-node` downstream if you want the full SDK; the
// span names and attributes here follow OTEL semantic-convention style so they
// line up.
// ---------------------------------------------------------------------------

import { randomBytes } from 'crypto';

/** Standard Sentinel agent span names (semantic conventions). */
export const SpanNames = {
  sessionStart: 'agent.session.start',
  sessionEnd: 'agent.session.end',
  think: 'agent.think',
  toolCall: 'agent.tool_call',
  toolBlocked: 'agent.tool_blocked',
  memoryWrite: 'agent.memory_write',
  memoryRead: 'agent.memory_read',
  delegate: 'agent.delegate',
  delegateReturn: 'agent.delegate_return',
} as const;

export type SpanStatus = 'unset' | 'ok' | 'error';
export type AttributeValue = string | number | boolean;

export interface SpanEvent {
  name: string;
  timeUnixNano: number;
  attributes: Record<string, AttributeValue>;
}

export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: number;
  endTimeUnixNano?: number;
  attributes: Record<string, AttributeValue>;
  events: SpanEvent[];
  status: SpanStatus;
}

export interface TracerOptions {
  serviceName?: string;
  /** Injectable clock (ns). Defaults to wall clock. */
  now?: () => number;
  /** Injectable id generator (for deterministic tests). */
  idGenerator?: { traceId(): string; spanId(): string };
  /** Called when a span ends (e.g. ship to a collector). */
  onEnd?: (span: SpanData) => void;
}

/** A live span. Call end() to finish it. */
export class Span {
  constructor(
    private readonly data: SpanData,
    private readonly tracer: Tracer,
  ) {}

  get traceId(): string { return this.data.traceId; }
  get spanId(): string { return this.data.spanId; }

  setAttribute(key: string, value: AttributeValue): this {
    this.data.attributes[key] = value;
    return this;
  }

  setAttributes(attrs: Record<string, AttributeValue>): this {
    Object.assign(this.data.attributes, attrs);
    return this;
  }

  addEvent(name: string, attributes: Record<string, AttributeValue> = {}): this {
    this.data.events.push({ name, timeUnixNano: this.tracer._now(), attributes });
    return this;
  }

  setStatus(status: SpanStatus): this {
    this.data.status = status;
    return this;
  }

  end(): SpanData {
    if (this.data.endTimeUnixNano === undefined) {
      this.data.endTimeUnixNano = this.tracer._now();
      if (this.data.status === 'unset') this.data.status = 'ok';
      this.tracer._finish(this.data);
    }
    return this.data;
  }

  snapshot(): SpanData {
    return { ...this.data, attributes: { ...this.data.attributes }, events: [...this.data.events] };
  }
}

export class Tracer {
  private readonly serviceName: string;
  private readonly clock: () => number;
  private readonly ids: { traceId(): string; spanId(): string };
  private readonly onEnd?: (span: SpanData) => void;
  private finished: SpanData[] = [];

  constructor(options: TracerOptions = {}) {
    this.serviceName = options.serviceName ?? 'sentinel';
    this.clock = options.now ?? (() => Date.now() * 1_000_000);
    this.ids = options.idGenerator ?? {
      traceId: () => randomBytes(16).toString('hex'),
      spanId: () => randomBytes(8).toString('hex'),
    };
    this.onEnd = options.onEnd;
  }

  /** Start a new span. Pass a parent to nest it within an existing trace. */
  startSpan(
    name: string,
    options: { attributes?: Record<string, AttributeValue>; parent?: Span | SpanData } = {},
  ): Span {
    const parent = options.parent instanceof Span ? options.parent.snapshot() : options.parent;
    const data: SpanData = {
      traceId: parent ? parent.traceId : this.ids.traceId(),
      spanId: this.ids.spanId(),
      parentSpanId: parent ? parent.spanId : undefined,
      name,
      startTimeUnixNano: this.clock(),
      attributes: { ...(options.attributes ?? {}) },
      events: [],
      status: 'unset',
    };
    return new Span(data, this);
  }

  /** All spans finished so far. */
  spans(): SpanData[] {
    return [...this.finished];
  }

  reset(): void {
    this.finished = [];
  }

  /** Export finished spans in OTLP resourceSpans JSON shape. */
  toOTLP(): unknown {
    return {
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: this.serviceName } }] },
          scopeSpans: [
            {
              scope: { name: 'sentinel', version: '0.2.0' },
              spans: this.finished.map((s) => ({
                traceId: s.traceId,
                spanId: s.spanId,
                parentSpanId: s.parentSpanId,
                name: s.name,
                startTimeUnixNano: String(s.startTimeUnixNano),
                endTimeUnixNano: s.endTimeUnixNano !== undefined ? String(s.endTimeUnixNano) : undefined,
                attributes: toOtlpAttributes(s.attributes),
                events: s.events.map((e) => ({
                  name: e.name,
                  timeUnixNano: String(e.timeUnixNano),
                  attributes: toOtlpAttributes(e.attributes),
                })),
                status: { code: statusCode(s.status) },
              })),
            },
          ],
        },
      ],
    };
  }

  /** @internal */
  _now(): number {
    return this.clock();
  }

  /** @internal */
  _finish(span: SpanData): void {
    this.finished.push(span);
    this.onEnd?.(span);
  }
}

function statusCode(status: SpanStatus): number {
  return status === 'ok' ? 1 : status === 'error' ? 2 : 0;
}

function toOtlpAttributes(attrs: Record<string, AttributeValue>): Array<{ key: string; value: Record<string, unknown> }> {
  return Object.entries(attrs).map(([key, value]) => ({ key, value: otlpValue(value) }));
}

function otlpValue(value: AttributeValue): Record<string, unknown> {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (Number.isInteger(value)) return { intValue: value };
  return { doubleValue: value };
}
