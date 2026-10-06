# User-Mac verification (required once)

macOS CI covers installed CLI and real-save filesystem → parser → HTTP behavior.
It does not run the user's FM26 application or installed Safari. These steps are
still unverified until performed on the actual Mac; record results without using
CI timing as a promise.

## First run

```bash
./install.sh
export PATH="$HOME/.local/bin:$PATH"
manager-room select-save
/usr/bin/time -lp manager-room start
manager-room doctor --deep --online
```

Choose the career you actually play. Verify the web UI shows a connected state,
the correct pinned save and a last-sync time. If the browser prompts for local
network access, approve access for the Manager Room page. A successful curl/doctor
network check alone does not prove browser access.

## Running-FM save and watcher

1. Launch FM26 and open the pinned career.
2. Record the current UI last-sync time, then save in FM26 to that same file.
3. Confirm the parser starts, the snapshot updates and the UI refreshes without
   reloading. Verify the correct club/player identity remains selected.
4. Save another career next to it; confirm Manager Room does not switch careers.
5. Close Terminal and confirm the browser still refreshes.
6. Run `manager-room stop`; confirm the API stops. Run `manager-room start` again.

If FM saves to a different path, stop, select that exact .fm file and start again.
Do not assume a renamed file has the same career identity without re-selection.

## Measurements on this Mac

Record hardware, macOS/FM build, save size and browser, then measure:

| Measurement | Evidence |
| --- | --- |
| Cold start | `/usr/bin/time -lp manager-room start`; includes first parse and watcher stabilization |
| First parse | `lastParseDurationMs` in `/api/health` or `doctor --deep` (private parse) |
| Save → UI refresh | Wall-clock time from FM save completion to visible last-sync change; repeat at least 5 times |
| CPU and memory | Activity Monitor during idle and repeated saves; inspect Companion and parser separately |
| Battery/energy | Activity Monitor Energy while idle and during saves; record power source and sampling duration |

The current watcher polls every second and stabilizes saves for 1.5 seconds; the
web UI polls every 5 seconds. These settings describe implementation, not measured
end-to-end latency or battery cost. Parser timing excludes browser/network/watcher
delay. Keep private save/player JSON out of public issues; share aggregate timings
and sanitized diagnostics instead.

## ChatGPT sign-in and AI Coach

These checks require your actual Mac and eligible ChatGPT account. CI does not
perform consent, real Keychain approval or live plan-backed inference.

1. Update Companion, then run `manager-room stop` and `manager-room start` without
   configuring an API key. Open AI Coach and select **Continue with ChatGPT**.
2. Verify the system browser opens the official OpenAI sign-in page. Choose the
   intended account/workspace and authorize plan usage. Return to Manager Room.
   Do not copy callback URLs, tokens or Keychain contents into reports.
3. Refresh models, select an available model and verify the selected account
   label. A connection or model list alone does not complete this check.
4. Preview one player's request. Confirm the account/model and intended fields,
   then send once. Confirm a completed Korean response and check ChatGPT usage.
5. Prepare another preview, switch model/account and verify the previous approval
   disappears. Log out and verify sending is unavailable. Log in to the saved
   connection and confirm the existing registration is reused.
6. Restart Companion, refresh models and verify the connection resumes from
   Keychain. After normal token expiry, explicitly refresh models or send a new
   approved request to check token renewal. Do not force requests to exhaust usage.
7. Cancel login; deny plan permission; temporarily disconnect the network. Verify
   the UI reports these states, partial replies are not shown as completed, and
   no automatic inference retry or API-key billing fallback occurs.
8. Verify the browser on the actual Mac (including Safari if used) can return to
   the loopback callback. Record only macOS/browser versions and sanitized outcomes.
