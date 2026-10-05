# Changelog

## 0.2.0

- `redact: false` records every value as is: no field-name or JWT redaction,
  no URL rewriting, query strings kept. A warning is logged at startup.
- `redact.fields` accepts `false` to hide nothing by field name.
- `redact.jwt` (default `true`) turns the JWT-shape check on or off.

## 0.1.0

- First release: `setupRequestTracing(app)` records providers, Prisma, cache
  and axios calls per request, with the `/dev/traces` viewer.
