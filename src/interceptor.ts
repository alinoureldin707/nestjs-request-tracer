import { CallHandler, ExecutionContext, HttpException, HttpStatus, NestInterceptor } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { Observable } from 'rxjs';

import { printRequestTrace } from './printer';
import { finishRequestTrace, redactUrl, runInRequestTrace } from './store';

type RequestLike = {
  method: string;
  url?: string;
  originalUrl?: string;
  path?: string;
  route?: { path?: string };
  routeOptions?: { url?: string };
  params?: unknown;
  query?: unknown;
  body?: unknown;
};

type ResponseLike = {
  statusCode?: number;
  headersSent?: boolean;
  writableFinished?: boolean;
  once?: (event: string, listener: () => void) => void;
  raw?: ResponseLike;
};

/**
 * Opens a trace for every HTTP request and keeps it as the async context of
 * the handler, so every traced call it makes lands in it. Closed once the
 * response has gone out, with the status the client received.
 *
 * Interceptors run after guards: a request a guard refuses is not traced.
 */
export class RequestTraceInterceptor implements NestInterceptor {
  constructor(
    private readonly shouldTrace: (path: string) => boolean,
    private readonly printToConsole: boolean,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<RequestLike>();
    // Fastify wraps the Node response; Express hands it over directly.
    const reply = context.switchToHttp().getResponse<ResponseLike>();
    const response = reply.raw ?? reply;
    const path = (request.path ?? request.originalUrl ?? request.url ?? '').split('?')[0];
    if (!this.shouldTrace(path)) return next.handle();

    return new Observable((subscriber) => {
      const startedAt = performance.now();
      let result: unknown;
      let handlerError: unknown;

      return runInRequestTrace(
        {
          method: request.method,
          url: redactUrl(path),
          route: request.route?.path ?? request.routeOptions?.url,
          handler: `${context.getClass().name}.${context.getHandler().name}`,
          args: { params: request.params, query: request.query, body: request.body },
        },
        (trace) => {
          let finished = false;
          const finish = (aborted: boolean) => {
            if (finished) return;
            finished = true;
            finishRequestTrace(
              trace,
              {
                aborted,
                statusCode: aborted ? undefined : resolveStatusCode(response, handlerError),
                result,
                error: handlerError,
              },
              performance.now() - startedAt,
            );
            if (this.printToConsole) printRequestTrace(trace);
          };

          if (typeof response.once === 'function') {
            response.once('finish', () => finish(false));
            response.once('close', () => finish(!response.writableFinished));
          }

          return next.handle().subscribe({
            next: (value) => {
              result = value;
              subscriber.next(value);
            },
            error: (error: unknown) => {
              handlerError = error;
              subscriber.error(error);
              if (typeof response.once !== 'function') finish(false);
            },
            complete: () => {
              subscriber.complete();
              if (typeof response.once !== 'function') finish(false);
            },
          });
        },
      );
    });
  }
}

function resolveStatusCode(response: ResponseLike, error: unknown): number {
  if (response.headersSent && response.statusCode) return response.statusCode;
  if (error instanceof HttpException) return error.getStatus();
  if (error) return HttpStatus.INTERNAL_SERVER_ERROR;
  return response.statusCode ?? HttpStatus.OK;
}
