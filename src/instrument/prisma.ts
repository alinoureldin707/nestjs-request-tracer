import { startTraceNode, traceCall } from '../store';

const OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

type PrismaLike = Record<string, unknown> & {
  $transaction: (...args: unknown[]) => unknown;
  _runtimeDataModel?: { models?: Record<string, unknown> };
};

/** A Prisma client, or a provider extending one. */
export function isPrismaClient(instance: object): instance is PrismaLike {
  const candidate = instance as Partial<PrismaLike>;
  return typeof candidate.$transaction === 'function' && typeof (candidate as { $connect?: unknown }).$connect === 'function';
}

/**
 * Model calls are recorded while the lazy Prisma promise is handed back as
 * is: `$transaction([...])` needs the real thing, and only `then` starts a
 * query, so the call settles when the caller awaits it. Queries made through
 * an interactive transaction's `tx` client are not seen.
 */
export function wrapPrismaClient(client: PrismaLike): number {
  let models = 0;

  for (const property of modelProperties(client)) {
    const delegate = client[property];
    if (!delegate || typeof delegate !== 'object') continue;

    const traced = new Proxy(delegate, {
      get(target, operation, receiver) {
        const value: unknown = Reflect.get(target, operation, receiver);
        if (typeof value !== 'function' || typeof operation !== 'string' || !OPERATIONS.has(operation)) return value;

        const run = value as (...args: unknown[]) => unknown;
        return (...args: unknown[]) => {
          const query = run.apply(target, args);
          const node = startTraceNode('prisma', `prisma.${property}.${operation}`, args[0]);
          return node ? followLazyPromise(query, node.settle) : query;
        };
      },
    });

    Object.defineProperty(client, property, { value: traced, configurable: true, writable: true });
    models += 1;
  }

  const transaction = client.$transaction;
  Object.defineProperty(client, '$transaction', {
    value: (...args: unknown[]) =>
      traceCall(
        'prisma',
        'prisma.$transaction',
        Array.isArray(args[0]) ? { queries: args[0].length } : { interactive: true },
        () => transaction.apply(client, args),
      ),
    configurable: true,
    writable: true,
  });

  return models;
}

/** Model accessors (`user`, `threeDsTransaction`) from the client's own data model. */
function modelProperties(client: PrismaLike): string[] {
  const models = client._runtimeDataModel?.models;
  if (models && typeof models === 'object') {
    return Object.keys(models).map((name) => name.charAt(0).toLowerCase() + name.slice(1));
  }
  // Older clients: any property holding an object with model operations.
  return Object.keys(client).filter((key) => {
    if (key.startsWith('$') || key.startsWith('_')) return false;
    const value = client[key] as Record<string, unknown> | undefined;
    return !!value && typeof value === 'object' && typeof value.findMany === 'function';
  });
}

function followLazyPromise(query: unknown, settle: (outcome: { result?: unknown; error?: unknown }) => void): unknown {
  type Then = (
    this: unknown,
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (error: unknown) => unknown,
  ) => unknown;
  const promise = query as { then?: Then } | null;
  if (!promise || typeof promise.then !== 'function') {
    settle({ result: query });
    return query;
  }

  const then = promise.then;
  promise.then = function (this: unknown, onFulfilled, onRejected) {
    return then.call(
      this,
      (value: unknown) => {
        settle({ result: value });
        return onFulfilled ? onFulfilled(value) : value;
      },
      (error: unknown) => {
        settle({ error });
        if (onRejected) return onRejected(error);
        throw error;
      },
    );
  };
  return promise;
}
