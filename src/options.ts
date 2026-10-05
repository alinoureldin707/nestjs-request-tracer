export type RedactOptions = {
  /**
   * Which field names have their values hidden. Applied to object keys and to
   * arguments, which are named after the method's parameters.
   *
   * The default compares the words of the key (`accessToken` → access, token)
   * with: authorization, password, passwd, token, secret, cookie, session,
   * pin, pincode, otp, cvv, cvc, iban, pan, ssn, and the pairs api/access/
   * private/secret + key and client + secret. So `pinCode` is hidden but
   * `ping` and `shipping` are not.
   *
   * `false` hides no field by name.
   */
  fields?: RegExp | ((key: string) => boolean) | false;
  /** Hide any string shaped like a JWT, wherever it sits. @default true */
  jwt?: boolean;
  /** Extra check on any string value, wherever it sits. */
  values?: (value: string) => boolean;
  /** What a hidden value is replaced with. @default '[REDACTED]' */
  replacement?: string;
  /** Rewrites a request or outgoing URL before it is shown, for secrets in
   * path segments (`/devices/<secret>`). Query strings are always dropped. */
  urls?: (url: string) => string;
};

export type RequestTracingOptions = {
  /**
   * Whether to trace at all. When false nothing is wrapped and no route is
   * added. @default process.env.NODE_ENV !== 'production'
   */
  enabled?: boolean;
  /** Where the viewer is served. @default '/dev/traces' */
  path?: string;
  /** How many requests are kept in memory, newest first. @default 100 */
  maxRequests?: number;
  /** Beyond this many calls a request's trace stops growing. @default 3000 */
  maxCallsPerRequest?: number;
  /** Print each finished request's call tree to the console. @default true */
  console?: boolean;
  /**
   * What is hidden from the recorded values. On by default; `false` records
   * everything as is — tokens, passwords, query strings — which is what you
   * want while debugging locally, and never on a shared server.
   */
  redact?: RedactOptions | false;
  /**
   * Which providers to wrap, by class name. By default, every provider whose
   * class comes from your own code (not from node_modules) is wrapped, except
   * guards, interceptors, filters, pipes and loggers.
   */
  include?: (className: string) => boolean;
  /** Class names never wrapped, on top of the defaults. */
  exclude?: (className: string) => boolean;
  /** Record Prisma model calls of any Prisma client provider. @default true */
  prisma?: boolean;
  /** Record calls to the cache registered as `CACHE_MANAGER`. @default true */
  cache?: boolean;
  /**
   * Record outgoing axios calls: every `HttpService` found, the default axios
   * instance, and the instances listed here. @default true
   */
  http?: boolean;
  /** More axios instances to record (`axios.create()` results). */
  axiosInstances?: unknown[];
  /** Request paths not traced, on top of the viewer's own. */
  ignorePaths?: (string | RegExp)[];
};

export type ResolvedOptions = Required<
  Omit<RequestTracingOptions, 'include' | 'exclude' | 'redact'>
> & {
  include?: (className: string) => boolean;
  exclude?: (className: string) => boolean;
  redact: ResolvedRedaction;
};

const SENSITIVE_WORDS = new Set([
  'authorization',
  'password',
  'passwd',
  'token',
  'secret',
  'cookie',
  'session',
  'pin',
  'pincode',
  'otp',
  'cvv',
  'cvc',
  'iban',
  'pan',
  'ssn',
]);
const SENSITIVE_PAIRS = new Set(['apikey', 'accesskey', 'privatekey', 'secretkey', 'clientsecret']);

/** The default field check: see `RedactOptions.fields`. */
export function isSensitiveFieldName(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some(
    (word, index) => SENSITIVE_WORDS.has(word) || SENSITIVE_PAIRS.has(word + (words[index + 1] ?? '')),
  );
}

export type ResolvedRedaction = {
  /** False when `redact: false`: values are recorded untouched. */
  enabled: boolean;
  fields?: (key: string) => boolean;
  jwt: boolean;
  values?: (value: string) => boolean;
  urls?: (url: string) => string;
  replacement: string;
};

export function resolveOptions(
  options: RequestTracingOptions = {},
): ResolvedOptions {
  return {
    enabled: options.enabled ?? process.env.NODE_ENV !== 'production',
    path: normalizePath(options.path ?? '/dev/traces'),
    maxRequests: options.maxRequests ?? 100,
    maxCallsPerRequest: options.maxCallsPerRequest ?? 3000,
    console: options.console ?? true,
    include: options.include,
    exclude: options.exclude,
    prisma: options.prisma ?? true,
    cache: options.cache ?? true,
    http: options.http ?? true,
    axiosInstances: options.axiosInstances ?? [],
    ignorePaths: options.ignorePaths ?? [],
    redact: resolveRedaction(options.redact),
  };
}

function resolveRedaction(redact: RequestTracingOptions['redact']): ResolvedRedaction {
  if (redact === false) return { enabled: false, jwt: false, replacement: '[REDACTED]' };
  return {
    enabled: true,
    fields: toFieldCheck(redact?.fields),
    jwt: redact?.jwt ?? true,
    values: redact?.values,
    urls: redact?.urls,
    replacement: redact?.replacement ?? '[REDACTED]',
  };
}

function toFieldCheck(fields: RedactOptions['fields']): ((key: string) => boolean) | undefined {
  if (fields === false) return undefined;
  if (!fields) return isSensitiveFieldName;
  if (typeof fields === 'function') return fields;
  return (key) => {
    fields.lastIndex = 0;
    return fields.test(key);
  };
}

function normalizePath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
