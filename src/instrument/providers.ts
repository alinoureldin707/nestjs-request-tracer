import type { INestApplication } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';

import type { ResolvedOptions } from '../options';
import { traceCall } from '../store';
import { copyMetadata, findLibraryClasses, methodNames, namedArguments, parameterNames } from './reflection';

/** Called by Nest around the lifecycle, never inside a request. */
const LIFECYCLE_METHODS = new Set([
  'onModuleInit',
  'onApplicationBootstrap',
  'onModuleDestroy',
  'beforeApplicationShutdown',
  'onApplicationShutdown',
]);

/**
 * Enhancers run outside a request's trace and loggers would trace their own
 * output. Controllers are never providers here: the trace's root stands for
 * the handler, and their route metadata must stay untouched.
 */
const SKIPPED_SUFFIXES = ['Guard', 'Interceptor', 'Filter', 'Pipe', 'Logger', 'LoggerService', 'Controller'];

/** Nest's own module, holding Reflector, ModuleRef and the like. */
const NEST_CORE_MODULES = new Set(['InternalCoreModule']);

export type ProviderVisitor = (instance: object, token: unknown, hostModule: unknown) => void;

/** Every resolved, statically scoped provider instance of the application, once. */
export function forEachProvider(app: INestApplication, visit: ProviderVisitor): void {
  const seen = new Set<object>();
  for (const module of app.get(ModulesContainer, { strict: false }).values()) {
    for (const [token, wrapper] of module.providers) {
      const instance = wrapper.instance as unknown;
      if (!instance || typeof instance !== 'object' || seen.has(instance)) continue;
      if (!wrapper.isDependencyTreeStatic()) continue;
      seen.add(instance);
      visit(instance, token, module.metatype);
    }
  }
}

export function wrapProviders(
  app: INestApplication,
  options: ResolvedOptions,
  isSpecial: (instance: object) => boolean,
): { providers: number; methods: number; libraryDetection: boolean } {
  const libraryClasses = findLibraryClasses();
  const isLibrary = (type: unknown) => libraryClasses?.has(type) ?? false;
  let providers = 0;
  let methods = 0;

  forEachProvider(app, (instance, _token, hostModule) => {
    if (isSpecial(instance)) return;

    const type = (instance as { constructor?: unknown }).constructor;
    if (typeof type !== 'function' || type === Object) return;
    const className = type.name;
    if (!className) return;

    const hostName = typeof hostModule === 'function' ? hostModule.name : '';
    const included = options.include
      ? options.include(className)
      : !isLibrary(type) &&
        !isLibrary(hostModule) &&
        !NEST_CORE_MODULES.has(hostName) &&
        !SKIPPED_SUFFIXES.some((suffix) => className.endsWith(suffix));
    if (!included || options.exclude?.(className)) return;

    providers += 1;
    methods += wrapInstance(instance, className);
  });

  return { providers, methods, libraryDetection: libraryClasses !== undefined };
}

function wrapInstance(instance: object, className: string): number {
  const target = instance as Record<string, unknown>;
  let count = 0;

  for (const name of methodNames(instance)) {
    if (LIFECYCLE_METHODS.has(name)) continue;
    const original = target[name];
    if (typeof original !== 'function') continue;

    const method = original as (...args: unknown[]) => unknown;
    const parameters = parameterNames(method);
    const label = `${className}.${name}`;

    const traced = function (this: unknown, ...args: unknown[]) {
      return traceCall('provider', label, namedArguments(parameters, args), () => method.apply(this, args));
    };
    copyMetadata(method, traced);
    Object.defineProperty(traced, 'name', { value: name });

    target[name] = traced;
    count += 1;
  }

  return count;
}
