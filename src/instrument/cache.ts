import { traceCall } from '../store';
import { namedArguments } from './reflection';

const METHODS: Record<string, string[]> = {
  get: ['key'],
  mget: ['keys'],
  set: ['key', 'value', 'ttl'],
  mset: ['entries'],
  del: ['key'],
  mdel: ['keys'],
  ttl: ['key'],
  wrap: ['key', 'fn', 'ttl'],
  reset: [],
  clear: [],
};

/** Records calls to a cache-manager instance (`@nestjs/cache-manager`). */
export function wrapCacheManager(cache: Record<string, unknown>): number {
  let count = 0;
  for (const [name, parameters] of Object.entries(METHODS)) {
    const original = cache[name];
    if (typeof original !== 'function') continue;

    const method = original as (...args: unknown[]) => unknown;
    cache[name] = (...args: unknown[]) =>
      traceCall('cache', `cache.${name}`, namedArguments(parameters, args), () => method.apply(cache, args));
    count += 1;
  }
  return count;
}
