# 0002: No shared-secret request signing

**Status:** accepted · **Date:** 2026-11-16

## Context

1.x extensions signed each batch with HMAC-SHA256 using a secret compiled into the extension. This
added no security: the extension is public, so anyone can extract the secret. It also caused a
production outage, because the server hashed re-serialised JSON whose key order didn't match what
the client signed.

## Decision

Drop request signing. Authenticate with per-user API keys over HTTPS, and protect data quality with
server-side plausibility rules ([ADR 0004](0004-overlap-based-plausibility.md)) that hold no matter
which client sent the request.

## Consequences

- Simpler clients and server, and no way to break auth through serialisation details.
- Anyone with their own API key can post arbitrary sessions for themselves. That's accepted: the
  plausibility rules bound how much time any account can claim.
