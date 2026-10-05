import { Logger } from '@nestjs/common';

import type { RequestTrace, TraceNode } from './store';

const logger = new Logger('RequestTrace');
const MAX_PREVIEW_LENGTH = 90;
let viewerPath = '/dev/traces';

export function setViewerPath(path: string): void {
  viewerPath = path;
}

/**
 * The call tree of a finished request, one line per call with its duration,
 * a short preview of its arguments and, when it threw, the error. The viewer
 * has the full values.
 */
export function printRequestTrace(trace: RequestTrace): void {
  const header = `${trace.method} ${trace.url} ${trace.statusCode ?? trace.state} ${trace.durationMs ?? '?'}ms · ${trace.nodeCount} calls · ${viewerPath}#${trace.id}`;
  const lines = [header, ...renderNode(trace.root, '', true)];
  if (trace.droppedNodes > 0) lines.push(`… ${trace.droppedNodes} more calls not recorded`);

  if (trace.statusCode !== undefined && trace.statusCode >= 400) logger.warn(lines.join('\n'));
  else logger.log(lines.join('\n'));
}

function renderNode(node: TraceNode, prefix: string, isLast: boolean): string[] {
  const duration = node.durationMs === undefined ? '' : ` ${node.durationMs}ms`;
  const args = preview(node.args);
  const error = node.error ? `  ✗ ${describe(node.error)}` : '';
  const line = `${prefix}${isLast ? '└─ ' : '├─ '}${node.label}${args ? `(${args})` : ''}${duration}${error}`;

  const childPrefix = prefix + (isLast ? '   ' : '│  ');
  return [
    line,
    ...node.children.flatMap((child, index) => renderNode(child, childPrefix, index === node.children.length - 1)),
  ];
}

function preview(value: unknown): string {
  if (value === undefined) return '';
  const text = JSON.stringify(value) ?? '';
  const inner = text.startsWith('{') && text.endsWith('}') ? text.slice(1, -1) : text;
  return inner.length > MAX_PREVIEW_LENGTH ? `${inner.slice(0, MAX_PREVIEW_LENGTH)}…` : inner;
}

function describe(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error);
  const { name, message, status } = error as { name?: string; message?: string; status?: number };
  return [status, name, message].filter(Boolean).join(' ');
}
