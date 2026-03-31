# AGENTS.md

Read these files before planning or implementing work in this repo:

- `docs/product/design.md`
- `docs/product/delivery-plan.md`

Repo purpose:

- local web app
- authorized-source playlist acquisition only
- DJ/electronic workflow optimized

Architecture defaults:

- Next.js App Router
- React
- TypeScript
- SQLite
- Playwright

Execution guidance:

- full approved scope is in play
- still decompose into planner-sized and worker-sized issues
- prioritize modular providers and explicit matching rules
- do not introduce stream-ripping or bypass flows
- for this repo, approved epic PRs to `main` should be auto-merged by the super agent; there is no human admin merge gate
