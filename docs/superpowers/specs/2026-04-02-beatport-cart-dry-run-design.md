# Beatport Cart Dry Run Design

## Goal

When a dry run falls through to paid Beatport fallback, the app should let the operator open one real Beatport cart/checkout page containing all unpaid Beatport review candidates for that run.

This should replace the current dead-end `Approve` concept with a workflow that matches what the operator actually wants:

1. run dry intake/matching
2. collect unresolved paid Beatport candidates
3. open one Beatport cart with all of them
4. complete checkout manually on Beatport
5. return to the app and use the existing purchased-download flow

## Non-Goals

- auto-paying Beatport checkout
- replacing the existing owned-download acquisition after purchase
- cross-provider cart building
- mutating local review state to pretend checkout succeeded before Beatport purchase completes
- clearing or rewriting an operator's pre-existing Beatport cart contents

## Current State

The codebase already has the substrate for paid fallback review:

- Beatport is a `paid-review-queue` provider, not an automatic provider
- dry runs can queue Beatport review candidates into `reviewQueue`
- the run report renders a Beatport review lane
- `Approve` only flips local status to `approved`
- `Purchased` is the step that actually tries to capture an owned Beatport download after checkout

Problem:

- `Approve` does not open Beatport
- `Approve` does not build a cart
- `Approve` does not help the operator move toward payment

## Constraints

- reuse the existing persisted Beatport authenticated browser session
- open a real visible Beatport browser window/tab for the operator
- preserve the existing `Purchased` flow for post-checkout owned-download acquisition
- keep the review queue as the source of truth for paid fallback candidates
- tolerate re-running cart build without corrupting local state

## Recommended Approach

Keep the existing review queue, but replace the operator action surface:

- remove the meaning of per-track `Approve` from the normal workflow
- add one run-level action: `Open Beatport Cart (N)`
- build the cart from all unpaid Beatport review entries for that run
- bring the Beatport cart/checkout page to the front in a single visible session
- keep per-track `Mark Purchased` and `Reject`

This keeps the system honest:

- local review rows still mean "candidate exists and is unpaid"
- Beatport cart state stays external until checkout actually happens
- purchased state is still only recorded after the owned artifact can be acquired

## Review Queue Semantics

`reviewQueue` remains the source of truth for paid fallback candidates.

### Eligible for cart build

Review rows should be cart-eligible when all are true:

- `providerKey === "beatport"`
- status is `queued` or legacy `approved`
- status is not `purchased`
- status is not `rejected`

### Status handling

- `queued`: default unpaid state; should be used for new rows
- `approved`: backward-compat state only; still cart-eligible, but new UI should stop creating it
- `purchased`: checkout completed and owned artifact acquired
- `rejected`: operator chose not to pursue the paid fallback

Cart building should **not** change review status.

Reason:

- adding to a Beatport cart is not a durable proof of purchase
- local status should only describe durable state the app knows to be true

## New Runtime Flow

### Run-level action

Add a run-level action in the Beatport review panel:

- label: `Open Beatport Cart (N)`
- `N` = count of eligible Beatport review entries

### Cart build flow

When triggered:

1. load all eligible Beatport review entries for the run
2. open an operator-owned headful Beatport browser session
3. verify Beatport auth state is present and valid
4. for each review entry:
   - navigate to the stored Beatport track URL when available
   - fallback to Beatport search using the stored review metadata if needed
   - locate the add-to-cart control
   - attempt to add the track into the current Beatport cart
5. after the batch attempt, navigate to or open the Beatport cart page
6. bring that page to the front for the operator
7. return a batch summary to the app

### Cart policy

Do not clear the existing Beatport cart.

Instead:

- add missing eligible tracks into the current cart
- tolerate duplicates or existing cart contents
- classify already-present items as `already-in-cart`

This is safer than deleting cart contents the operator may care about.

## Proposed Module Changes

### 1. Beatport cart orchestration

Extend the Beatport provider boundary with a cart-builder capability, for example:

- `buildRunCart(...)`
- or a dedicated `beatport-cart.ts` module adjacent to the provider

Responsibilities:

- open operator-owned Beatport session
- reuse persisted auth
- resolve each review entry to an addable Beatport track page
- click add-to-cart controls
- navigate to cart/checkout page
- return structured per-entry results

### 2. Run-level cart API

Add a run-level endpoint, for example:

- `POST /api/runs/[runId]/review-queue/cart`

Input:

- none beyond run id

Output:

- run id
- eligible review count
- batch summary counts
- per-review result rows
- optionally the final Beatport cart URL if available

### 3. Report UI

Update the Beatport review panel to:

- show `Open Beatport Cart (N)` when eligible rows exist
- remove the practical importance of `Approve`
- keep per-row provider links
- keep `Mark Purchased`
- keep `Reject`
- surface the latest cart-build summary

## Cart Build Result Model

Each attempted review entry should return one of:

- `added`
- `already-in-cart`
- `not-found`
- `provider-error`

Batch-level failure states should include:

- `auth-expired`
- `session-conflict`

Behavior:

- if auth is expired or missing, fail early and tell the operator to refresh Beatport session setup
- if a background Beatport session is already active, fail with a clear conflict message
- if some rows fail but session is valid, still land on the Beatport cart page

## Persisted State For Cart Attempts

The review queue should remain the canonical paid-fallback list, but the app should persist the latest cart-build result per review row so the run report survives refresh.

Recommended addition to `run_track_reviews`:

- `cart_status` nullable enum
- `cart_detail` nullable text
- `cart_updated_at` nullable timestamp

Suggested values:

- `added`
- `already-in-cart`
- `not-found`
- `provider-error`

Why persist this:

- operator can refresh and still see what made it into the cart
- repeated cart builds can update stale failures
- the run report can show which tracks still need manual rescue

Do not persist `auth-expired` as a per-row status because that is a batch/session failure, not a track-specific outcome.

## UI Behavior

### Beatport panel

Show:

- run-level `Open Beatport Cart (N)` button
- compact batch summary such as `7 added, 2 already in cart, 1 failed`
- per-row cart status badge when available

### Per-row controls

Keep:

- `Mark Purchased`
- `Reject`

Remove from the normal path:

- `Approve`

Legacy compatibility:

- if old rows already have `approved`, treat them as eligible for cart build and for purchased acquisition

## Post-Checkout Flow

No change to the existing owned-download refresh model:

1. operator completes manual payment on Beatport
2. operator returns to the run report
3. operator clicks `Mark Purchased` for each purchased row
4. app uses the existing Beatport owned-download acquisition path
5. run progresses into packaging once all reviews resolve

This keeps checkout concerns separate from owned-download retrieval.

## Error Handling

### Session/auth

- missing Beatport auth: return actionable auth/setup error
- expired Beatport auth: return actionable refresh error
- operator/background session conflict: return actionable conflict error

### Track-level add failures

- missing provider URL: fallback to Beatport search
- search miss: `not-found`
- add-to-cart selector mismatch: `provider-error`
- duplicate/already-present cart entry: `already-in-cart`

### Batch behavior

- continue past per-track failures
- always attempt to land on cart page if session remains usable
- never mark local review rows as purchased during cart build

## Testing

Coverage should include:

### Provider/cart orchestration

- batch add-to-cart success for multiple review rows
- already-in-cart detection
- selector failure / provider error
- search fallback when provider URL is missing

### API

- run-level cart endpoint returns correct batch summary
- auth/session conflict failures are surfaced correctly

### UI

- Beatport review panel renders `Open Beatport Cart (N)`
- per-row `Approve` is removed from the normal lane
- cart-build summary renders after action

### Store/report mapping

- persisted cart result fields round-trip through run store
- legacy `approved` rows remain cart-eligible

## Rollout

Phase 1:

- add run-level cart build action
- persist latest cart-build results
- update report UI
- keep existing `Mark Purchased` flow unchanged

Phase 2, only if needed:

- smarter dedupe against existing cart contents
- optional "retry failed cart adds" shortcut
- richer cart reconciliation after checkout

## Recommendation

Implement a run-level Beatport cart builder on top of the existing paid review queue.

This is the best fit because it:

- matches the operator's actual checkout flow
- avoids lying with local `approved` state
- preserves the existing post-purchase owned-download path
- keeps paid fallback history and retryability inside the run report
