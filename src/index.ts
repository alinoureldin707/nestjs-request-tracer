import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';

import { axiosOfHttpService, defaultAxiosInstance, instrumentAxios, isAxiosInstance } from './instrument/axios';
import { wrapCacheManager } from './instrument/cache';
import { isPrismaClient, wrapPrismaClient } from './instrument/prisma';
import { forEachProvider, wrapProviders } from './instrument/providers';
import { RequestTraceInterceptor } from './interceptor';
import { RequestTracingOptions, resolveOptions } from './options';
import { setViewerPath } from './printer';
import { configureStore } from './store';
import { registerViewerRoutes } from './viewer/routes';

export type { RedactOptions, RequestTracingOptions } from './options';
export { isSensitiveFieldName } from './options';
export type { RequestTrace, RequestTraceSummary, TraceNode, TraceNodeKind } from './store';
export {
  clearRequestTraces,
  getRequestTrace,
  isTracing,
  listRequestTraces,
  recordTraceLeaf,
  traceCall,
} from './store';

const logger = new Logger('RequestTrace');
const CACHE_MANAGER = 'CACHE_MANAGER';
let installed = false;

/**
 * Turns request tracing on for [app]: every call each request makes through
 * your providers, Prisma, the cache manager and axios is recorded as a tree
 * with arguments, results, errors and timings, browsable at `options.path`
 * (`/dev/traces` by default) and printed to the console.
 *
 * Call it once, after `NestFactory.create` and before `app.listen`:
 *
 * ```ts
 * const app = await NestFactory.create(AppModule);
 * setupRequestTracing(app);
 * await app.listen(3000);
 * ```
 *
 * Off when `NODE_ENV=production` unless `enabled` says otherwise. The values
 * recorded are redacted unless `redact: false`, but they are your request
 * data either way: do not expose the viewer on a public deployment.
 *
 * Returns whether tracing was installed.
 */
export function setupRequestTracing(app: INestApplication, options: RequestTracingOptions = {}): boolean {
  const resolved = resolveOptions(options);
  if (!resolved.enabled) return false;
  if (installed) {
    logger.warn('setupRequestTracing was called more than once; ignoring the later call.');
    return true;
  }
  installed = true;

  configureStore(resolved);
  setViewerPath(resolved.path);

  let prismaModels = 0;
  let caches = 0;
  let axiosClients = 0;
  const special = new Set<object>();

  forEachProvider(app, (instance, token) => {
    if (resolved.prisma && isPrismaClient(instance)) {
      special.add(instance);
      prismaModels += wrapPrismaClient(instance);
    } else if (resolved.cache && token === CACHE_MANAGER) {
      special.add(instance);
      if (wrapCacheManager(instance as Record<string, unknown>) > 0) caches += 1;
    } else if (resolved.http) {
      const client = axiosOfHttpService(instance);
      if (client) {
        special.add(instance);
        if (instrumentAxios(client)) axiosClients += 1;
      }
    }
  });

  if (resolved.http) {
    for (const client of [defaultAxiosInstance(), ...resolved.axiosInstances]) {
      if (isAxiosInstance(client) && instrumentAxios(client)) axiosClients += 1;
    }
  }

  const wrapped = wrapProviders(app, resolved, (instance) => special.has(instance));

  const ignored = resolved.ignorePaths;
  const shouldTrace = (path: string) =>
    !path.startsWith(resolved.path) &&
    !ignored.some((rule) => (typeof rule === 'string' ? path.startsWith(rule) : rule.test(path)));
  app.useGlobalInterceptors(new RequestTraceInterceptor(shouldTrace, resolved.console));

  registerViewerRoutes(app, resolved.path);

  if (!wrapped.libraryDetection && !resolved.include) {
    logger.warn(
      'No CommonJS module cache (ESM build?): every provider outside Nest core is wrapped, library ones included. Pass `include` to choose.',
    );
  }
  logger.log(
    `Request tracing on: ${wrapped.methods} methods in ${wrapped.providers} providers, ${prismaModels} Prisma models, ${caches} cache, ${axiosClients} axios clients. Viewer at ${resolved.path}`,
  );
  if (!resolved.redact.enabled) {
    logger.warn('Redaction is off (redact: false): tokens, passwords and query strings are recorded as is.');
  }
  return true;
}
