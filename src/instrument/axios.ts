import { recordTraceLeaf, redactUrl } from '../store';

type AxiosConfigLike = {
  method?: string;
  url?: string;
  baseURL?: string;
  params?: unknown;
  data?: unknown;
  [key: symbol]: unknown;
};
type AxiosResponseLike = { status: number; data: unknown; config: AxiosConfigLike };
type AxiosInstanceLike = {
  interceptors: {
    request: { use: (onFulfilled: (config: AxiosConfigLike) => AxiosConfigLike) => unknown };
    response: {
      use: (
        onFulfilled: (response: AxiosResponseLike) => AxiosResponseLike,
        onRejected: (error: unknown) => unknown,
      ) => unknown;
    };
  };
};

const STARTED_AT = Symbol('nestjsRequestTracerStartedAt');
const instrumented = new WeakSet<object>();

export function isAxiosInstance(value: unknown): value is AxiosInstanceLike {
  const interceptors = (value as AxiosInstanceLike | undefined)?.interceptors;
  return typeof interceptors?.request?.use === 'function' && typeof interceptors?.response?.use === 'function';
}

/** An `HttpService` from `@nestjs/axios`, which carries its axios instance. */
export function axiosOfHttpService(instance: object): AxiosInstanceLike | undefined {
  const axiosRef = (instance as { axiosRef?: unknown }).axiosRef;
  return isAxiosInstance(axiosRef) ? axiosRef : undefined;
}

/** The application's default axios instance, when it has axios installed. */
export function defaultAxiosInstance(): AxiosInstanceLike | undefined {
  try {
    const resolved = require.resolve('axios', { paths: [process.cwd()] });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require(resolved) as { default?: unknown };
    const instance = loaded.default ?? loaded;
    return isAxiosInstance(instance) ? instance : undefined;
  } catch {
    return undefined;
  }
}

/** Records each call made through [client] under the function that made it. */
export function instrumentAxios(client: AxiosInstanceLike): boolean {
  if (instrumented.has(client)) return false;
  instrumented.add(client);

  client.interceptors.request.use((config) => {
    config[STARTED_AT] = performance.now();
    return config;
  });
  client.interceptors.response.use(
    (response) => {
      record(response.config, response);
      return response;
    },
    (error: unknown) => {
      const { config, response, code, message } = (error ?? {}) as {
        config?: AxiosConfigLike;
        response?: AxiosResponseLike;
        code?: string;
        message?: string;
      };
      record(config, response, code ?? message ?? 'request failed');
      return Promise.reject(error);
    },
  );
  return true;
}

function record(config: AxiosConfigLike | undefined, response: AxiosResponseLike | undefined, failure?: string): void {
  const startedAt = config?.[STARTED_AT];
  const status = response?.status;
  recordTraceLeaf(
    'http',
    `${(config?.method ?? 'get').toUpperCase()} ${resolveUrl(config)}`,
    {
      args: { params: config?.params, data: parseBody(config?.data) },
      result: response ? { status, data: response.data } : undefined,
      error: failure ?? (status !== undefined && status >= 400 ? { status } : undefined),
    },
    typeof startedAt === 'number' ? performance.now() - startedAt : undefined,
  );
}

/** Axios serializes a JSON body before the response comes back. */
function parseBody(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}

/** Query strings often carry keys; the params are shown, redacted, instead. */
function resolveUrl(config: AxiosConfigLike | undefined): string {
  if (!config?.url) return redactUrl(config?.baseURL ?? '');
  if (!config.baseURL || /^https?:\/\//i.test(config.url)) return redactUrl(config.url);
  try {
    return redactUrl(new URL(config.url, config.baseURL).toString());
  } catch {
    return redactUrl(config.url);
  }
}
