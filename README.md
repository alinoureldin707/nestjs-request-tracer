# nestjs-request-tracer

See everything a NestJS request does: every service method it calls, with its
arguments and return value, every Prisma query, cache read and outgoing HTTP
call, nested as a tree with timings, in a web viewer built into your app.

```
POST /payments 201 48ms · 9 calls · /dev/traces#3f2a91c0
└─ PaymentsController.create({"body":{"amount":5,"pin":"[REDACTED]"}}) 48ms
   └─ PaymentsService.pay("token":"[REDACTED]","amount":5) 47ms
      ├─ UsersService.findByToken("token":"[REDACTED]") 6ms
      │  └─ prisma.user.findUnique("where":{"id":7}) 4ms
      ├─ cache.get("key":"rates:EUR") 1ms
      └─ POST https://psp.example.com/charges 31ms
```

One line in `main.ts`, no module to import, nothing to change in your services.

## Install

```bash
npm install nestjs-request-tracer
```

Peer dependencies: `@nestjs/common` and `@nestjs/core` 9 or later, `rxjs` 7, `reflect-metadata`.

## Use

```ts
// main.ts
import { NestFactory } from '@nestjs/core';
import { setupRequestTracing } from 'nestjs-request-tracer';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  setupRequestTracing(app); // after create, before listen
  await app.listen(3000);
}
bootstrap();
```

Start the app, make a few requests, and open **http://localhost:3000/dev/traces**.
Pick a request on the left to see its call tree; click any call for its full
arguments, result and error. Each finished request is also printed as a tree
to the console.

By default it is **off when `NODE_ENV=production`**.

## What is recorded

| Kind | What | How it is found |
|---|---|---|
| `handler` | The controller method: params, query, body and the value it returned | A global interceptor |
| `provider` | Every method of your own providers (services, repositories, private helpers…), with arguments named after the parameters | Nest's container; classes from `node_modules` are left alone |
| `prisma` | `prisma.<model>.<operation>` with its arguments and result, and `$transaction` | Any provider that is a Prisma client (or extends one) |
| `cache` | `get`, `set`, `del`… | The provider registered as `CACHE_MANAGER` |
| `http` | Method, URL, params, body, status and response of every axios call | Every `HttpService` (`@nestjs/axios`), the default axios instance, and `axiosInstances` |
| `custom` | Whatever you wrap with `traceCall` | You |

Not traced: guards (they run before the request's trace starts), requests a
guard refuses, controllers' internals (the handler is the root), and queries
made through an interactive transaction's `tx` client.

## Options

```ts
setupRequestTracing(app, {
  enabled: process.env.APP_ENV === 'dev', // default: NODE_ENV !== 'production'
  path: '/dev/traces',                    // where the viewer is served
  maxRequests: 100,                       // requests kept in memory
  maxCallsPerRequest: 3000,               // a trace stops growing past this
  console: true,                          // print each request's tree
  redact: {
    fields: /secret|token|password/i,     // or (key) => boolean; see below
    values: (value) => value.startsWith('sk_live_'),
    replacement: '[REDACTED]',
    urls: (url) => url.replace(/\/devices\/[^/]+/, '/devices/[REDACTED]'),
  },
  include: (className) => className.endsWith('Service'), // replaces the default selection
  exclude: (className) => className === 'NoisyService',
  prisma: true,
  cache: true,
  http: true,
  axiosInstances: [myAxios],              // instances made with axios.create()
  ignorePaths: ['/health', /^\/metrics/],
});
```

### Redaction

Every argument, result and error goes through redaction before it is stored:

- **Field names.** By default a key is hidden when one of its words (`accessToken` → access, token) is authorization, password, passwd, token, secret, cookie, session, pin, pincode, otp, cvv, cvc, iban, pan or ssn, or a pair api/access/private/secret + key or client + secret. `pinCode` is hidden; `ping` and `shipping` are not. Boolean values are never hidden (`mustChangePin: true` says nothing about the PIN).
- **Arguments are named after the parameters.** `getUser(token)` is recorded as `{ token: … }`, so a secret passed positionally is caught too.
- **JWTs** are hidden wherever they appear.
- **URLs** lose their query string; the params are shown, redacted, instead.

The data is still your request data: names, emails, amounts. Keep the viewer
off public deployments.

### Tracing your own code

```ts
import { traceCall, recordTraceLeaf, isTracing } from 'nestjs-request-tracer';

const total = traceCall('custom', 'pricing.compute', { basket }, () => compute(basket));
recordTraceLeaf('custom', 'webhook queued', { args: { id } });
```

Both do nothing outside a traced request.

## How it works

- `setupRequestTracing` walks Nest's module container once and replaces each
  method of your providers with a wrapper on the instance. Outside a request
  the wrapper is a plain call; inside one it records the call under the
  current one, using `AsyncLocalStorage`, so the tree follows `await`.
  Decorator metadata is copied onto the wrapper, so `@Cron`, `@OnEvent` and
  similar keep working.
- "Your classes" are the ones not exported by a module loaded from
  `node_modules`, or from outside the working directory. Under ESM there is
  no module cache to tell them apart; pass `include` there.
- Prisma calls are recorded without touching the lazy Prisma promise, so
  `$transaction([...])` still works. Inside an array transaction the queries
  show as pending, since Prisma never awaits them one by one.
- The viewer and its JSON are served straight on the HTTP adapter (Express or
  Fastify), outside Nest's router, guards and interceptors.
- Everything lives in memory and is lost on restart.

## Endpoints

| | |
|---|---|
| `GET /dev/traces` | The viewer |
| `GET /dev/traces/data` | Recent requests (summaries) |
| `GET /dev/traces/data/:id` | One request with its full call tree |
| `DELETE /dev/traces/data` | Forget every request |

## License

MIT
