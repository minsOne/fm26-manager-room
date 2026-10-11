#!/usr/bin/env python3
"""Create an experimental save COPY with two named-selection references swapped.

Not a supported game writer. Requires the existing read-only parser and zstd CLI.
Never overwrites a file; never writes to the source or a running game.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess

MAGIC = b'\x02\x01fmf.'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def decompress(data):
    return subprocess.check_output(['zstd', '-d', '-q', '--stdout'], input=data)


def compress(data):
    return subprocess.check_output(['zstd', '-3', '-q', '--stdout'], input=data)


def directory_entries(payload):
    """Walk every directory, including rgman children omitted by the reader index."""
    cursor = 0
    entries = []

    def take(size):
        nonlocal cursor
        if size < 0 or cursor + size > len(payload):
            raise ValueError('truncated directory')
        data = payload[cursor:cursor + size]
        cursor += size
        return data

    def integer():
        return struct.unpack('<I', take(4))[0]

    def string():
        size = integer()
        if size > 4096:
            raise ValueError('directory string exceeds bound')
        return take(size).decode('utf-8')

    def directory(parent, depth):
        if depth > 16:
            raise ValueError('directory nesting exceeds bound')
        name = string()
        path = parent + [name]
        count = integer()
        if count > 100000 or len(entries) + count > 100000:
            raise ValueError('entry count exceeds bound')
        for _ in range(count):
            entry_name, extension = string(), string()
            tail = cursor
            relative, size, expanded, _, _ = struct.unpack('<QQQQQ', take(40))
            entries.append(dict(path=path, name=entry_name, extension=extension,
                                tail=tail, offset=26 + relative, size=size, expanded=expanded))
        children = integer()
        if children > 1000:
            raise ValueError('directory count exceeds bound')
        for _ in range(children):
            directory(path, depth + 1)

    directory([], 0)
    if cursor != len(payload):
        raise ValueError('unparsed directory bytes; refusing reconstruction')
    return entries


def unpack(source):
    if len(source) < 26 or source[:6] != MAGIC:
        raise ValueError('not an FM container')
    trailer = 9 + struct.unpack_from('<Q', source, 9)[0]
    if not 26 <= trailer < len(source) - 9 or source[trailer:trailer + 6] != MAGIC:
        raise ValueError('invalid trailer')
    payload = decompress(source[trailer + 9:])
    entries = directory_entries(payload)
    for entry in entries:
        if entry['offset'] < 26 or entry['offset'] + entry['size'] > trailer:
            raise ValueError('entry outside container')
    return trailer, payload, entries


def swap_named_references(tactics, name, first, second):
    if not name or len(name.encode()) > 256:
        raise ValueError('invalid saved selection name')
    if not 0 <= first < 20 or not 0 <= second < 20 or first == second:
        raise ValueError('two distinct populated indices in 0..19 required')
    marker = b'\x03' + struct.pack('<I', len(name.encode())) + name.encode()
    if tactics.count(marker) != 1:
        raise ValueError('saved selection marker missing or ambiguous')
    start = tactics.index(marker) + len(marker)
    if start + 104 > len(tactics):
        raise ValueError('truncated selection')
    values = struct.unpack_from('<26I', tactics, start)
    if len(set(values[:20])) != 20 or any(v in (0, 0xffffffff) for v in values[:20]) \
            or values[20:] != (0xffffffff,) * 6:
        raise ValueError('does not match observed 20-player/6-empty research layout')
    result = bytearray(tactics)
    struct.pack_into('<I', result, start + first * 4, values[second])
    struct.pack_into('<I', result, start + second * 4, values[first])
    allowed = set(range(start + first * 4, start + first * 4 + 4)) | \
        set(range(start + second * 4, start + second * 4 + 4))
    changed = [i for i, (a, b) in enumerate(zip(tactics, result)) if a != b]
    if not changed or not set(changed) <= allowed:
        raise ValueError('unexpected tactics mutation')
    return bytes(result), changed


def reconstruct(source, name, first, second):
    result, report = reconstruct_tactics(
        source, lambda original: swap_named_references(original, name, first, second))
    report.update(savedSelectionName=name, swappedWordIndices=[first, second])
    return result, report


def reconstruct_tactics(source, transform):
    """Internal copy builder; callers must establish the allowed lineup mutation."""
    trailer, payload, entries = unpack(source)
    targets = [e for e in entries if e['name'] == 'tactics_man' and e['extension'] == '.dat']
    if len(targets) != 1:
        raise ValueError('unique tactics section required')
    target = targets[0]
    start, end = target['offset'], target['offset'] + target['size']
    for entry in entries:
        if entry is not target and entry['offset'] < end and entry['offset'] + entry['size'] > start:
            raise ValueError('overlapping section extent')
    original = decompress(source[start:end])
    if len(original) != target['expanded']:
        raise ValueError('tactics size mismatch')
    patched, changed = transform(original)
    if len(patched) != len(original) or not changed or len(changed) > 104:
        raise ValueError('invalid lineup patch extent')
    if changed != [i for i, (a, b) in enumerate(zip(original, patched)) if a != b]:
        raise ValueError('patch differs outside declared bytes')
    frame = compress(patched)
    delta = len(frame) - target['size']
    directory = bytearray(payload)
    for entry in entries:
        if entry is target:
            struct.pack_into('<Q', directory, entry['tail'] + 8, len(frame))
        elif entry['offset'] >= end:
            struct.pack_into('<Q', directory, entry['tail'], entry['offset'] - 26 + delta)
    result = bytearray(source[:start] + frame + source[end:trailer]
                       + source[trailer:trailer + 9] + compress(directory))
    struct.pack_into('<Q', result, 9, trailer + delta - 9)
    new_trailer, new_directory, new_entries = unpack(result)
    if new_directory != directory or len(new_entries) != len(entries):
        raise ValueError('directory reconstruction mismatch')
    if result[26:start] != source[26:start] or result[start + len(frame):new_trailer] != source[end:trailer]:
        raise ValueError('non-tactics body changed, including unlisted data')
    # Check every compressed entry, including nested entries, independently.
    for old, new in zip(entries, new_entries):
        before = source[old['offset']:old['offset'] + old['size']]
        after = result[new['offset']:new['offset'] + new['size']]
        if old is target:
            if decompress(after) != patched:
                raise ValueError('tactics readback mismatch')
        elif before != after:
            raise ValueError('another section changed')
    return bytes(result), dict(sourceSHA256=sha(source), outputSHA256=sha(result),
        originalTacticsSHA256=sha(original), patchedTacticsSHA256=sha(patched),
        changedTacticsByteOffsets=changed, directoryEntriesVerified=len(entries),
        allOtherCompressedEntriesIdentical=True, unlistedBodyBytesIdentical=True,
        gameLoadVerified=False, liveSelectionApplied=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--saved-name', required=True)
    parser.add_argument('--swap', nargs=2, type=int, required=True, metavar=('FIRST', 'SECOND'))
    parser.add_argument('--reader', type=Path, required=True)
    args = parser.parse_args()
    source = args.source.read_bytes()
    if sha(source) != args.source_sha256:
        raise ValueError('source hash changed; review the new source before experimenting')
    if args.output.exists() or args.output.is_symlink():
        raise ValueError('output must be a new file')
    evidence = json.loads(subprocess.check_output([
        str(args.reader.resolve()), 'lineup-research', str(args.source.resolve()), args.saved_name]))
    refs = evidence['references'][:20]
    if len(refs) != 20 or any(len(r['playerUidCandidates']) != 1 for r in refs):
        raise ValueError('all populated references must resolve to unique player UIDs')
    if len({r['playerUidCandidates'][0] for r in refs}) != 20:
        raise ValueError('duplicate player UID')
    result, report = reconstruct(source, args.saved_name, *args.swap)
    if args.source.read_bytes() != source:
        raise ValueError('source changed during experiment')
    report['swappedPlayersBefore'] = [refs[i] for i in args.swap]
    # Exclusive creation also rejects source aliases, existing files and symlinks.
    with args.output.open('xb') as output:
        output.write(result)
    if sha(args.output.read_bytes()) != report['outputSHA256']:
        raise ValueError('output disk readback mismatch')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
