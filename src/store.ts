import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type { ResolvedOptions } from './options';

export type TraceNodeKind = 'handler' | 'provider' | 'http' | 'prisma' | 'cache' | 'custom';

export type TraceNode = {
  id: number;
  kind: TraceNodeKind;
  /** `Class.method`, `prisma.user.findUnique`, `GET https://…`. */
  label: string;
  args?: unknown;
  result?: unknown;
  error?: unknown;
  /** Milliseconds since the request started. */
  startMs: number;
  durationMs?: number;
  children: TraceNode[];
};

export type RequestTrace = {
  id: string;
  startedAt: string;
  method: string;
  url: string;
  route?: string;
  handler: string;
  statusCode?: number;
  durationMs?: number;
  /** Still running, or the client went away before the answer. */
  state: 'pending' | 'finished' | 'aborted';
  nodeCount: number;
  /** Calls not recorded once the trace reached its size limit. */
  droppedNodes: number;
  root: TraceNode;
};

export type RequestTraceSummary = Omit<RequestTrace, 'root'> & { error?: string };

type TraceContext = { trace: RequestTrace; origin: number; node: TraceNode };
type Outcome = { result?: unknown; error?: unknown };

const MAX_DEPTH = 6;
const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 100;
const JWT_PATTERN = /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/;

const storage = new AsyncLocalStorage<TraceContext>();
const traces: RequestTrace[] = [];

let settings: Pick<ResolvedOptions, 'maxRequests' | 'maxCallsPerRequest' | 'redact'> = {
  maxRequests: 100,
  maxCallsPerRequest: 3000,
  redact: { fields: (key) => /token|secret|password/i.test(key), replacement: '[REDACTED]' },
};

export function configureStore(options: ResolvedOptions): void {
  settings = options;
}

/** [url] without its query string, through the configured URL redaction. */
export function redactUrl(url: string): string {
  const path = url.split('?')[0];
  return settings.redact.urls ? settings.redact.urls(path) : path;
}

/** Opens the trace of one request and runs [fn] inside it. */
export function runInRequestTrace<T>(
  request: {
    method: string;
    url: string;
    route?: string;
    handler: string;
    args?: unknown;
  },
  fn: (trace: RequestTrace) => T,
): T {
  const root: TraceNode = {
    id: 0,
    kind: 'handler',
    label: request.handler,
    args: toTraceValue(request.args),
    startMs: 0,
    children: [],
  };
  const trace: RequestTrace = {
    id: randomUUID().slice(0, 8),
    startedAt: new Date().toISOString(),
    method: request.method,
    url: request.url,
    route: request.route,
    handler: request.handler,
    state: 'pending',
    nodeCount: 1,
    droppedNodes: 0,
    root,
  };

  traces.unshift(trace);
  if (traces.length > settings.maxRequests) traces.length = settings.maxRequests;

  return storage.run({ trace, origin: performance.now(), node: root }, () => fn(trace));
}

export function finishRequestTrace(
  trace: RequestTrace,
  outcome: { statusCode?: number; aborted: boolean } & Outcome,
  durationMs: number,
): void {
  trace.state = outcome.aborted ? 'aborted' : 'finished';
  trace.statusCode = outcome.statusCode;
  trace.durationMs = round(durationMs);
  trace.root.durationMs = trace.durationMs;
  if (outcome.result !== undefined) trace.root.result = toTraceValue(outcome.result);
  if (outcome.error !== undefined) trace.root.error = describeError(outcome.error);
}

/** Whether the current code runs inside a traced request. */
export function isTracing(): boolean {
  return storage.getStore() !== undefined;
}

/**
 * Runs [fn] as a recorded call under the current one, following a returned
 * promise to its settlement. Outside a traced request it just runs [fn].
 *
 * Exported so you can trace code the automatic wrapping does not reach:
 * `traceCall('custom', 'pricing.compute', { basket }, () => compute(basket))`.
 */
export function traceCall<T>(kind: TraceNodeKind, label: string, args: unknown, fn: () => T): T {
  const opened = openNode(kind, label, args);
  if (!opened) return fn();

  let returned: T;
  try {
    returned = storage.run(opened.context, fn);
  } catch (error) {
    opened.settle({ error });
    throw error;
  }

  if (isPromiseLike(returned)) {
    return (returned as PromiseLike<unknown>).then(
      (result) => {
        opened.settle({ result });
        return result;
      },
      (error: unknown) => {
        opened.settle({ error });
        throw error;
      },
    ) as T;
  }

  opened.settle({ result: returned });
  return returned;
}

/**
 * Records a call whose end is reported later through `settle` — for a value
 * that must be handed back untouched, such as a lazy Prisma promise.
 * Undefined outside a traced request.
 */
export function startTraceNode(
  kind: TraceNodeKind,
  label: string,
  args: unknown,
): { settle: (outcome: Outcome) => void } | undefined {
  const opened = openNode(kind, label, args);
  return opened && { settle: opened.settle };
}

/** Adds a finished leaf, such as an outgoing HTTP call, under the current call. */
export function recordTraceLeaf(
  kind: TraceNodeKind,
  label: string,
  details: { args?: unknown; result?: unknown; error?: unknown },
  durationMs?: number,
): void {
  const context = storage.getStore();
  if (!context || !reserveNode(context.trace)) return;

  context.node.children.push({
    id: context.trace.nodeCount - 1,
    kind,
    label,
    args: toTraceValue(details.args),
    result: toTraceValue(details.result),
    error: details.error === undefined ? undefined : describeError(details.error),
    startMs: round(performance.now() - context.origin - (durationMs ?? 0)),
    durationMs: durationMs === undefined ? undefined : round(durationMs),
    children: [],
  });
}

export function listRequestTraces(): RequestTraceSummary[] {
  return traces.map(({ root, ...summary }) => ({ ...summary, error: errorName(root.error) }));
}

export function getRequestTrace(id: string): RequestTrace | undefined {
  return traces.find((trace) => trace.id === id);
}

export function clearRequestTraces(): void {
  traces.length = 0;
}

/**
 * A JSON-safe, redacted copy of [value]: secrets by field name or value shape,
 * cycles, depth, long strings and long lists are cut down.
 */
export function toTraceValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === undefined || value === null) return value;
  const { redact } = settings;

  switch (typeof value) {
    case 'string':
      if (JWT_PATTERN.test(value) || redact.values?.(value)) return redact.replacement;
      return value.length > MAX_STRING_LENGTH
        ? `${value.slice(0, MAX_STRING_LENGTH)}… (${value.length} chars)`
        : value;
    case 'number':
    case 'boolean':
      return value;
    case 'bigint':
      return `${value.toString()}n`;
    case 'symbol':
      return value.toString();
    case 'function':
      return `[Function ${value.name || 'anonymous'}]`;
  }

  const object = value as object;
  if (object instanceof Date) return object.toISOString();
  if (Buffer.isBuffer(object)) return { type: 'Buffer', length: object.length };
  if (object instanceof Error) return describeError(object);
  if (object instanceof Map) return toTraceValue(Object.fromEntries(object), depth, seen);
  if (object instanceof Set) return toTraceValue([...object], depth, seen);
  if (isValueObject(object)) return String(object);

  if (seen.has(object)) return '[Circular]';
  if (depth >= MAX_DEPTH) return Array.isArray(object) ? '[Array]' : '[Object]';
  seen.add(object);

  if (Array.isArray(object)) {
    const items = object.slice(0, MAX_ARRAY_ITEMS).map((item) => toTraceValue(item, depth + 1, seen));
    if (object.length > MAX_ARRAY_ITEMS) items.push(`… ${object.length - MAX_ARRAY_ITEMS} more`);
    return items;
  }

  const entries = Object.entries(object);
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of entries.slice(0, MAX_OBJECT_KEYS)) {
    // A flag such as `mustChangePin` says nothing about the secret itself.
    const hidden = typeof entry !== 'boolean' && redact.fields(key);
    copy[key] = hidden ? redact.replacement : toTraceValue(entry, depth + 1, seen);
  }
  if (entries.length > MAX_OBJECT_KEYS) copy['…'] = `${entries.length - MAX_OBJECT_KEYS} more keys`;
  return copy;
}

function openNode(kind: TraceNodeKind, label: string, args: unknown) {
  const context = storage.getStore();
  if (!context || !reserveNode(context.trace)) return undefined;

  const startedAt = performance.now();
  const node: TraceNode = {
    id: context.trace.nodeCount - 1,
    kind,
    label,
    args: toTraceValue(args),
    startMs: round(startedAt - context.origin),
    children: [],
  };
  context.node.children.push(node);

  let settled = false;
  return {
    context: { ...context, node },
    settle: (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      node.durationMs = round(performance.now() - startedAt);
      if ('error' in outcome) node.error = describeError(outcome.error);
      else if (outcome.result !== undefined) node.result = toTraceValue(outcome.result);
    },
  };
}

function reserveNode(trace: RequestTrace): boolean {
  if (trace.nodeCount >= settings.maxCallsPerRequest) {
    trace.droppedNodes += 1;
    return false;
  }
  trace.nodeCount += 1;
  return true;
}

function describeError(error: unknown): unknown {
  if (error instanceof Error) {
    const http = error as Error & { getStatus?: () => number; getResponse?: () => unknown };
    return {
      name: error.name,
      message: error.message,
      ...(typeof http.getStatus === 'function' ? { status: http.getStatus() } : {}),
      ...(typeof http.getResponse === 'function' ? { response: toTraceValue(http.getResponse()) } : {}),
    };
  }
  return toTraceValue(error);
}

function errorName(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const { response, name } = error as { name?: string; response?: { name?: unknown } };
  return typeof response?.name === 'string' ? response.name : name;
}

function isPromiseLike(value: unknown): boolean {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

/** Prisma's Decimal, URL, ObjectId and similar read best as text. */
function isValueObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null;
  if (!prototype || prototype === Object.prototype || Array.isArray(value)) return false;
  const name = prototype.constructor?.name;
  return name === 'Decimal' || name === 'URL' || name === 'ObjectId' || name === 'ObjectID';
}

function round(milliseconds: number): number {
  return Math.round(milliseconds * 10) / 10;
}
