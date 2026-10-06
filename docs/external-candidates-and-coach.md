# External candidates, AI Coach and archive transfer

## Candidate search

The Rust parser now supports `candidates <save.fm> <query> <offset>`. It searches
all decoded player records outside the managed club, matching case-insensitive
name substrings or exact UID. An empty query includes all decoded external
records. Results sort by CA descending then UID and return at most 100 per page.
This is not proof that every player in every FM build was decoded or that a
player is interested, registered, healthy or affordable. Recent external match
history is omitted rather than silently complete.

Use the installed Companion to generate a page from the pinned save. It takes a
private fresh parse and attaches the current selection ID without replacing the
running UI snapshot:

```bash
manager-room candidates --query "" --offset 0 > candidates.json
manager-room candidates --query "" --offset 100 > candidates-next.json
manager-room candidates --query "player name" --offset 0 > named-candidates.json
```

In Recruitment, use the name/UID search form and previous/next page buttons to query the local Companion directly. CLI-generated JSON remains supported through the file picker. Import requires matching career ID,
manager/club, game date, source and database version. Pages replace the currently
loaded external page; they do not merge into the managed squad or persistent
observation archive. A changed snapshot clears the page. Imported pages are user
supplied files, not signed/trusted attestations. A new game ID invalidates old
pages even if its date and club match.

The independent fmsave audit checks two pages and an exact UID query, including
named attributes, abilities, identity, contracts and pagination metadata. This is
reference equivalence on the public fixture, not full-world game-screen proof.

## OpenAI Coach

The native CLI connects directly to the fixed HTTPS OpenAI Responses endpoint.
There is no browser API-key field and no background AI request. The Coach tab can preview and explicitly send through the local Companion, in addition to the CLI below. Select one squad
UID and a model available to your own API project:

```bash
manager-room coach --player 123 --question "역할 적합도 근거를 설명해줘" --model YOUR_MODEL_ID
```

Default behavior reparses the pinned save into a private temporary snapshot and
prints the request preview locally. It does not send or require an API key. Only
a second invocation with `--send` sends the then-current selected player's
observations and your question. The save may have advanced between invocations;
rerun the preview when needed. Data includes UID, age/known flags, CA/PA/known
flags, positions, attributes, fitness and retained minutes. It excludes save/path,
club/player names, wages, hidden personality and the whole save file. Your own
question text is also sent, so only include what you intend to share.

Set `OPENAI_API_KEY` locally through your normal secret-management workflow, and
optionally `OPENAI_MODEL` instead of `--model`. Keys are not CLI arguments, browser
storage, output or archives. They are removed from parser child environments.
Do not paste keys into issues or chat. `--send` can incur API charges.

```bash
manager-room coach --player 123 --question "역할 적합도 근거를 설명해줘" --model YOUR_MODEL_ID --send
```

The implementation uses `store: false`, no tools or conversation replay, a bounded
one-player input, timeout/response limits, no redirects and no automatic retries.
`store: false` is not a claim of zero retention under every provider policy. The
answer is returned as JSON-escaped text with an AI interpretation label; it cannot
execute a game action. Missing values stay unknown in the prompt, and model text
is not treated as verified medical/eligibility or calibrated numerical evidence.

Official protocol reference:
https://developers.openai.com/api/docs/guides/migrate-to-responses

Tests cover preview privacy, known flags, request structure, response text
selection, HTTP/incomplete-response rejection and the installed preview command.
No live paid API call is claimed by CI; actual account/model access requires the
user's API configuration. The Coach tab provides the same one-player, single-request workflow. It does not replay a conversation or persist prompts/replies.

## Portable observations

Settings exports a versioned JSON file and previews imported segment/date counts
before the explicit replacement button is enabled. Restore validates size,
version, dates, IDs, attributes and journals and persists before swapping memory.
Invalid data or quota failure retains the existing archive. An explicit valid
restore can recover a corrupt stored archive. The file includes IDs, attributes,
career identity and review drafts; treat it as private.

Restore replaces this Bridge's entire local archive, not the game/save or UI
selection. Matching career IDs can resume in another browser using the same
Companion; a different Mac's newly generated career ID is not silently rebound.
Unknown archive versions are rejected. Back up first if both browsers have useful
records. No cloud service or automatic cross-device identity reconciliation is
implied.

## Web search and Coach setup

After updating/reinstalling Companion, pinned-career candidate search works directly
from Recruitment. Each query takes a private parse, verifies the managed snapshot
still matches, and returns one page without replacing the live snapshot. Search
may take up to 120 seconds; health/polling continue while it runs. Failed searches
retain prior results. The bridge accepts one action at a time.

For local Coach preview, set a model on startup; no API key is required:

```bash
manager-room stop
manager-room start --model YOUR_MODEL_ID
```

For explicit web sends, set `OPENAI_API_KEY` using local secret management, then:

```bash
manager-room stop
manager-room start --model YOUR_MODEL_ID --enable-web-coach
```

`OPENAI_MODEL` can replace `--model`. Start reuses an already running service, so
stop/start is required to change its model, key or web-send option. The enable flag
only permits requests; it never initiates a provider call. Select one managed
player and enter a question, inspect the full request preview, then press the
separate confirmation/send button. API charges may apply. Every preview is a
one-use in-memory ticket valid for 120 seconds, bound to the precise snapshot,
selection ID and successful parse. A later preview replaces the earlier ticket.
It is consumed before networking even on errors, disconnects or ambiguous timeouts;
there is no automatic retry. Check provider usage before choosing to retry.

A changed game, parser error/activity, snapshot update or Bridge switch invalidates
web previews/replies. Question edits invalidate the prior confirmation. Requests,
responses and tickets are not persisted. Model output is escaped text, never HTML.
The Coach explains parser observations; it does not supply missing eligibility,
medical facts, game rules or verified outcomes.

The fixed loopback `/api/actions` route accepts bounded JSON POSTs with exact
Host/Origin checks, a per-process capability token in a custom header, strict
Content-Length, no transfer encoding and a five-second request read limit. Other
routes retain GET/OPTIONS only. CORS permits POST/PNA only on this route and never
exposes the provider key. Long work runs off the HTTP queue with time/size limits.
The Origin allow-list trusts `https://minsone.github.io` (the entire origin) and
specified localhost development origins; it is not isolation from local software
or hostile content already running on those trusted origins. No game-write API
is introduced.

Coverage: Swift tests check exact approved request bytes, expiration, new parses,
new careers, failed-send replay and private candidate parsing. Socket tests check
fragmented bodies, tokens, origin and request limits. Real-save Chromium/WebKit CI
uses actual candidate pagination and local Coach preview with a dummy model;
intercepted browser tests cover confirmation and escaping. No live paid provider
call or user-Mac/Safari validation is claimed.
