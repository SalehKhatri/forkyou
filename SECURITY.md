# Security policy

## Reporting a vulnerability

**Please don't report security issues in public issues, discussions or pull requests.**

Use GitHub's private vulnerability reporting instead: go to this repository's **Security** tab and
click **Report a vulnerability**. Only the maintainer can see the report.

If you can't use GitHub, email **saleh@forkyou.dev** with "SECURITY" in the subject line.

Please include:

- what the issue is and its impact (e.g. "read another user's stats", "bypass session overlap check")
- steps to reproduce, or a proof of concept
- the affected component (`apps/api`, `apps/web`, an editor extension) and version or commit

## What to expect

ForkYou is maintained by one person, so timelines are best effort:

- an acknowledgement within **7 days**
- an initial assessment and planned fix timeline within **14 days**
- credit in the release notes once a fix ships, unless you'd rather stay anonymous

Please give us a reasonable amount of time to fix the issue before disclosing it publicly.

## Scope

In scope: the code in this repository and the hosted service at `forkyou.dev`. Examples:
authentication or authorization flaws, API key or session leaks, ways to read another user's
private data (projects, settings), injection, and server-side request forgery.

Out of scope:

- inflating **your own** coding time. The overlap rules bound it by design
  (see [ADR 0004](docs/adr/0004-overlap-based-plausibility.md)), but report it if you can exceed
  wall-clock time
- denial of service through volume, and automated scanner output without a demonstrated impact
- vulnerabilities in third-party dependencies with no exploitable path in ForkYou (Dependabot
  tracks those)

## Supported versions

Only the latest version on `main` (and what's deployed at `forkyou.dev`) gets security fixes.
ForkYou 1.x is no longer maintained.
