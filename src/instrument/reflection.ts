/** Method names along the prototype chain, without getters, setters or the constructor. */
export function methodNames(instance: object): string[] {
  const names = new Set<string>();
  let prototype = Object.getPrototypeOf(instance) as object | null;

  while (prototype && prototype !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor' || names.has(name)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (descriptor && typeof descriptor.value === 'function') names.add(name);
    }
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }

  return [...names];
}

/**
 * Parameter names read from the compiled source. A destructured or otherwise
 * unnamed parameter comes back as null and is shown as `argN`.
 */
export function parameterNames(fn: (...args: never[]) => unknown): (string | null)[] {
  const source = Function.prototype.toString.call(fn);
  const open = source.indexOf('(');
  if (open < 0) return [];

  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let quote: string | null = null;

  for (let index = open + 1; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index - 1] !== '\\') quote = null;
      current += char;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '(' || char === '{' || char === '[') depth++;
    else if (char === ')' || char === '}' || char === ']') {
      if (depth === 0) break;
      depth--;
    } else if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);

  return parts.map((part) => {
    const name = part.trim().replace(/^\.\.\./, '').split('=')[0].trim();
    return /^[A-Za-z_$][\w$]*$/.test(name) ? name : null;
  });
}

/** The arguments keyed by parameter name, so a secret passed positionally
 * (`getUser(token)`) is redacted like a field of that name. */
export function namedArguments(parameters: (string | null)[], args: unknown[]): Record<string, unknown> | undefined {
  if (args.length === 0) return undefined;
  const named: Record<string, unknown> = {};
  args.forEach((value, index) => {
    named[parameters[index] ?? `arg${index}`] = value;
  });
  return named;
}

/** Keeps decorators that read metadata off the method (`@Cron`, `@OnEvent`)
 * working when they look at the instance after the wrap. */
export function copyMetadata(from: object, to: object): void {
  const reflect = Reflect as unknown as {
    getMetadataKeys?: (target: object) => unknown[];
    getMetadata?: (key: unknown, target: object) => unknown;
    defineMetadata?: (key: unknown, value: unknown, target: object) => void;
  };
  if (!reflect.getMetadataKeys || !reflect.getMetadata || !reflect.defineMetadata) return;
  for (const key of reflect.getMetadataKeys(from)) {
    reflect.defineMetadata(key, reflect.getMetadata(key, from), to);
  }
}

/**
 * Classes exported by libraries, found through the module cache: anything
 * loaded from node_modules or from outside the working directory. Every other
 * class is taken to be the application's — including those a file declares
 * without exporting. `undefined` under ESM, where there is no module cache.
 */
export function findLibraryClasses(): Set<unknown> | undefined {
  if (typeof require === 'undefined' || !require.cache) return undefined;

  const root = process.cwd();
  const classes = new Set<unknown>();
  for (const loaded of Object.values(require.cache)) {
    if (!loaded?.filename) continue;
    if (loaded.filename.startsWith(root) && !loaded.filename.includes('node_modules')) continue;

    let exported: unknown;
    try {
      exported = loaded.exports;
    } catch {
      continue;
    }
    if (typeof exported === 'function') classes.add(exported);
    else if (exported && typeof exported === 'object')
      for (const key of Object.keys(exported as object)) {
        try {
          const value = (exported as Record<string, unknown>)[key];
          if (typeof value === 'function') classes.add(value);
        } catch {
          // A lazy export that throws when read is not a class we need.
        }
      }
  }
  return classes;
}
