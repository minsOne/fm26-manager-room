# Pinned save selection

Manager Room can persist one explicitly selected `.fm` save instead of following whichever file in the FM26 games directory was modified most recently.

## Commands

Pin a save:

```bash
manager-room-companion pin-save "/path/to/My Career.fm"
```

Inspect the current selection:

```bash
manager-room-companion selection
```

Clear it:

```bash
manager-room-companion unpin-save
```

Then start the service normally:

```bash
manager-room-companion serve
```

When a valid pinned selection exists, the watcher observes only that file. A newer neighboring `.fm` file is ignored. In-place writes to the pinned file are still detected and re-parsed.

## Precedence

1. `serve --save /path/file.fm` — explicit session selection.
2. `serve --save-dir /path/dir` — explicit legacy directory-latest mode.
3. persisted `pin-save` selection.
4. default FM26 games directory in directory-latest compatibility mode.

The parser status API exposes `selectionId`, `selectedSavePath` and `selectionMode`. The guarded web client uses `selectionId` as its preferred career identity so renaming the same selected save does not look like an unrelated career.

## Safety

The selection store contains only the local path, a random selection ID and creation time. It does not copy or modify the save. The existing parser still reads a private staged copy and preserves the last valid snapshot on failure.

A pinned file that is removed or becomes unreadable does not cause an automatic switch to a different save.
