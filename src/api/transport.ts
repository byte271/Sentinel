import { v4 as uuid } from 'uuid';
import type { ActionIntent, TraceRecord, SentinelError } from '../kernel/types.js';
import { SentinelErrorImpl } from '../kernel/types.js';

export interface ApiRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
  correlationId: string;
  timestamp: number;
}

export interface ApiResponse {
  id: string;
  requestId: string;
  status: 'ok' | 'error';
  data?: unknown;
  error?: SentinelError;
  correlationId: string;
  timestamp: number;
}

export type EventHandler = (event: { type: string; data: unknown }) => void;

export class ApiLayer {
  private handlers: Map<string, (params: Record<string, unknown>) => Promise<unknown>> =
    new Map();
  private eventSubscribers: Map<string, EventHandler[]> = new Map();

  registerHandler(
    method: string,
    handler: (params: Record<string, unknown>) => Promise<unknown>,
  ): void {
    this.handlers.set(method, handler);
  }

  async handle(request: ApiRequest): Promise<ApiResponse> {
    const handler = this.handlers.get(request.method);

    if (!handler) {
      return {
        id: uuid(),
        requestId: request.id,
        status: 'error',
        error: ApiLayer.createError(
          'METHOD_NOT_FOUND',
          `No handler registered for method: ${request.method}`,
          'api',
        ),
        correlationId: request.correlationId,
        timestamp: Date.now(),
      };
    }

    try {
      const data = await handler(request.params);
      return {
        id: uuid(),
        requestId: request.id,
        status: 'ok',
        data,
        correlationId: request.correlationId,
        timestamp: Date.now(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        id: uuid(),
        requestId: request.id,
        status: 'error',
        error: ApiLayer.createError('HANDLER_ERROR', message, 'api'),
        correlationId: request.correlationId,
        timestamp: Date.now(),
      };
    }
  }

  subscribe(eventType: string, handler: EventHandler): () => void {
    const subscribers = this.eventSubscribers.get(eventType) ?? [];
    subscribers.push(handler);
    this.eventSubscribers.set(eventType, subscribers);

    return () => {
      const current = this.eventSubscribers.get(eventType);
      if (current) {
        const index = current.indexOf(handler);
        if (index !== -1) {
          current.splice(index, 1);
        }
      }
    };
  }

  emit(eventType: string, data: unknown): void {
    const subscribers = this.eventSubscribers.get(eventType) ?? [];
    const event = { type: eventType, data };
    for (const handler of subscribers) {
      handler(event);
    }
  }

  createRequest(method: string, params: Record<string, unknown>): ApiRequest {
    const correlationId = uuid();
    return {
      id: uuid(),
      method,
      params,
      correlationId,
      timestamp: Date.now(),
    };
  }

  static createError(code: string, message: string, module: string): SentinelError {
    return new SentinelErrorImpl(code, message, module, { recoverable: false });
  }
}
