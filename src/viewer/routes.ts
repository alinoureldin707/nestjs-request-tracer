import type { INestApplication } from '@nestjs/common';

import { clearRequestTraces, getRequestTrace, listRequestTraces } from '../store';
import { VIEWER_HTML } from './html';

type Handler = (request: { params?: Record<string, string> }, response: unknown) => void;
type AdapterLike = {
  get: (path: string, handler: Handler) => unknown;
  delete: (path: string, handler: Handler) => unknown;
  reply: (response: unknown, body: unknown, statusCode?: number) => unknown;
  setHeader: (response: unknown, name: string, value: string) => unknown;
};

/**
 * Serves the viewer and its data straight on the HTTP adapter, outside Nest's
 * router: no module to import, no guard or interceptor in the way, and the
 * same code for Express and Fastify. Registered before `listen`, so ahead of
 * the application's own routes.
 */
export function registerViewerRoutes(app: INestApplication, path: string): void {
  const adapter = app.getHttpAdapter() as unknown as AdapterLike;
  const send = (response: unknown, body: unknown, status = 200, contentType?: string) => {
    adapter.setHeader(response, 'Cache-Control', 'no-store');
    if (contentType) adapter.setHeader(response, 'Content-Type', contentType);
    adapter.reply(response, body, status);
  };

  adapter.get(path, (_request, response) => send(response, VIEWER_HTML, 200, 'text/html; charset=utf-8'));
  adapter.get(`${path}/data`, (_request, response) => send(response, listRequestTraces()));
  adapter.get(`${path}/data/:id`, (request, response) => {
    const trace = getRequestTrace(request.params?.id ?? '');
    if (trace) send(response, trace);
    else send(response, { message: 'Trace not found' }, 404);
  });
  adapter.delete(`${path}/data`, (_request, response) => {
    clearRequestTraces();
    send(response, { success: true });
  });
}
