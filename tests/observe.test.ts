// ---------------------------------------------------------------------------
// Feature 12: Observable Agent Protocol tests.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { Tracer, SpanNames } from '../src/observe/otel.js';

function deterministicTracer() {
  let t = 0;
  let id = 0;
  return new Tracer({
    serviceName: 'sentinel-test',
    now: () => (t += 1000),
    idGenerator: {
      traceId: () => `trace-${id}`,
      spanId: () => `span-${id++}`,
    },
  });
}

describe('Tracer — spans', () => {
  it('emits a span with attributes and an ok status on end', () => {
    const tracer = deterministicTracer();
    const span = tracer.startSpan(SpanNames.toolCall, { attributes: { 'tool.name': 'http.get' } });
    span.setAttribute('http.status', 200);
    span.addEvent('received');
    span.end();

    const spans = tracer.spans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('agent.tool_call');
    expect(spans[0].attributes['tool.name']).toBe('http.get');
    expect(spans[0].status).toBe('ok');
    expect(spans[0].events[0].name).toBe('received');
    expect(spans[0].endTimeUnixNano).toBeGreaterThan(spans[0].startTimeUnixNano);
  });

  it('nests child spans under the same trace', () => {
    const tracer = deterministicTracer();
    const session = tracer.startSpan(SpanNames.sessionStart);
    const child = tracer.startSpan(SpanNames.think, { parent: session });
    expect(child.traceId).toBe(session.traceId);
    expect(child.snapshot().parentSpanId).toBe(session.spanId);
  });

  it('records error status for blocked actions', () => {
    const tracer = deterministicTracer();
    const span = tracer.startSpan(SpanNames.toolBlocked, { attributes: { rule: 'destr-rm-rf-root', risk: 'critical' } });
    span.setStatus('error').end();
    expect(tracer.spans()[0].status).toBe('error');
  });
});

describe('Tracer — OTLP export', () => {
  it('exports OTLP resourceSpans with the service name and spans', () => {
    const tracer = deterministicTracer();
    tracer.startSpan(SpanNames.memoryWrite, { attributes: { 'memory.hash': 'abc' } }).end();
    const otlp = tracer.toOTLP() as {
      resourceSpans: Array<{
        resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
        scopeSpans: Array<{ spans: Array<{ name: string; attributes: Array<{ key: string }> }> }>;
      }>;
    };
    const rs = otlp.resourceSpans[0];
    expect(rs.resource.attributes[0].value.stringValue).toBe('sentinel-test');
    expect(rs.scopeSpans[0].spans[0].name).toBe('agent.memory_write');
    expect(rs.scopeSpans[0].spans[0].attributes.some((a) => a.key === 'memory.hash')).toBe(true);
  });
});

describe('Tracer — onEnd hook', () => {
  it('invokes the collector callback when a span ends', () => {
    const shipped: string[] = [];
    const tracer = new Tracer({ onEnd: (s) => shipped.push(s.name) });
    tracer.startSpan(SpanNames.delegate).end();
    expect(shipped).toEqual(['agent.delegate']);
  });
});
