# Companion reliability verification

## Run

```bash
bash tools/test_companion_core.sh
swift build --package-path companion/macos -c release
python3 tools/test_companion_http.py --binary companion/macos/.build/release/manager-room-companion
```

The core suite uses Swift 6 Foundation and runs on Linux and macOS. The HTTP test requires the macOS build with Network.framework. Tests do not contain a real save, invoke the real Rust parser or write to FM's save folder.

## Import behaviour

The runner copies a save into a unique private directory, checks the original signature, executes the explicitly selected native parser against the copy, validates the result, rechecks the source, and publishes with SnapshotStore's atomic write. Standard output and standard error are separate files, avoiding the classic sequential-pipe-drain deadlock. Temporary files are removed on success/failure.

Defaults: 120-second execution deadline, 64 MiB stdout, 8 MiB stderr. These are defensive limits, not performance estimates. Sizes are polled while running and checked before reading; not hard OS disk quotas. The timeout terminates the direct parser process, then kills it if it ignores termination. The supported Rust binary does not spawn a subprocess tree; arbitrary executables are not sandboxed by this runner.

A stability interval reduces partially written imports but cannot prove FM has finished forever. The staged copy protects mmap access, and normal source changes detected during an import reject publication. On any failure the previous snapshot remains. The browser preserves the previous snapshot with an explicit stale/error state and invalidates pending web action results when parser state changes.

## API boundary

Only IPv4 loopback is bound. Requests must use Host `127.0.0.1:<port>` or `localhost:<port>`. Browser origins are exact matches for `https://minsone.github.io`, local HTTP development on port 8080, and the local API origin. Opaque `null`, arbitrary sites, suffix tricks and arbitrary localhost ports are rejected. No credentialed CORS or wildcard CORS is enabled. GET requests without Origin are permitted for native local clients, subject to Host checks; action POSTs require an allowed Origin.

GitHub Pages paths share the `https://minsone.github.io` origin. This policy is origin-level, not path-level authentication; all pages under that user's GitHub Pages origin are inside the same trust boundary. It does not protect against malicious software already running as the same local user. Local network browser permissions may still require user approval.

Headers are read across packet boundaries with a 16 KiB cap and a five-second request-read deadline; duplicate headers are rejected. Read routes retain bodyless GET/OPTIONS. Only `/api/actions` additionally permits POST: exact allowed Origin, per-process token in a custom header, JSON content type and a fixed body length from 1 to 8192 bytes are required. Transfer encoding and Expect are rejected. Candidate parsing and provider work run off the HTTP queue with their own bounds. `/api/health` does not hash the game executable on each poll and serializes absent values as JSON null.

Web AI sends are disabled unless the Companion is started with `--enable-web-coach` and a local key/model. Preview never calls the provider. Send consumes a 120-second ticket bound to the exact snapshot, selection and successful parse before networking; errors and disconnects never trigger automatic retries. No game-write route is provided. See [web search and Coach setup](external-candidates-and-coach.md#web-search-and-coach-setup) for the complete request contract and remaining live-provider validation.

## Evidence boundaries

- Core tests cover unknown/broken schema, duplicate UID, CA ranges, dates, source preservation, concurrent change rejection, large stderr, timeout, output limits, explicit binary selection, asynchronous invocation and watcher in-place writes/deduplication.
- These tests validate transport/lifecycle behaviour and a structural snapshot contract. They do not prove named attribute offsets, nationality mapping, game rules, training efficacy or recommendation probabilities.
- A new input-copy and validation phase adds work. Re-measure end-to-end macOS latency; do not reuse the earlier Rust-only benchmark as a UI refresh time.
