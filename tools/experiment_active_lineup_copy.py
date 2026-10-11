#!/usr/bin/env python3
"""Replay a game-observed two-slot lineup swap into a new copy of its baseline.

Only accepts a controlled pair whose tactics sections differ by that exact swap.
No arbitrary offset or memory writing. Game validation is still required.
"""
import argparse
import json
from pathlib import Path
import struct

from experiment_lineup_copy import decompress, reconstruct_tactics, sha, unpack


def tactics(source):
    _, _, entries = unpack(source)
    matches = [e for e in entries if e['name'] == 'tactics_man' and e['extension'] == '.dat']
    if len(matches) != 1:
        raise ValueError('unique tactics section required')
    entry = matches[0]
    return decompress(source[entry['offset']:entry['offset'] + entry['size']])


def observed_swap(before, after, expected_refs, first, second):
    if len(expected_refs) != 26 or len(set(expected_refs[:20])) != 20 \
            or any(type(v) is not int or not 0 < v < 0xffffffff for v in expected_refs[:20]) \
            or expected_refs[20:] != [0xffffffff] * 6:
        raise ValueError('expected UI-identified 20-player/6-empty reference sequence required')
    if first == second or not 0 <= first < 20 or not 0 <= second < 20:
        raise ValueError('two distinct populated indices required')
    if len(before) != len(after):
        raise ValueError('tactics length changed; controlled pair required')
    marker = struct.pack('<26I', *expected_refs)
    changed_refs = list(expected_refs)
    changed_refs[first], changed_refs[second] = changed_refs[second], changed_refs[first]
    replacement = struct.pack('<26I', *changed_refs)
    matches = []
    cursor = 0
    while True:
        offset = before.find(marker, cursor)
        if offset < 0:
            break
        candidate = before[:offset] + replacement + before[offset + len(marker):]
        if candidate == after:
            matches.append(offset)
        cursor = offset + 1
    if len(matches) != 1:
        raise ValueError('no unique exact game-observed swap; reject unrelated tactics changes')
    changes = [i for i, (a, b) in enumerate(zip(before, after)) if a != b]
    if not changes or len(changes) > 8:
        raise ValueError('not a two-reference swap')
    return matches[0], changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--before-sha256', required=True)
    parser.add_argument('--after-sha256', required=True)
    parser.add_argument('--expected-references', type=Path, required=True)
    parser.add_argument('--swap', nargs=2, type=int, required=True)
    args = parser.parse_args()
    before, after = args.before.read_bytes(), args.after.read_bytes()
    if sha(before) != args.before_sha256 or sha(after) != args.after_sha256:
        raise ValueError('evidence source hash mismatch')
    before_tactics, after_tactics = tactics(before), tactics(after)
    refs = json.loads(args.expected_references.read_text())
    offset, changes = observed_swap(before_tactics, after_tactics, refs, *args.swap)

    def transform(original):
        if original != before_tactics:
            raise ValueError('source tactics differ from controlled baseline')
        return after_tactics, changes

    result, report = reconstruct_tactics(before, transform)
    report.update(mode='game-observed-active-swap-experiment',
                  observationAfterSHA256=sha(after), observedReferenceOffset=offset,
                  swappedWordIndices=args.swap)
    with args.output.open('xb') as output:
        output.write(result)
    if sha(args.output.read_bytes()) != report['outputSHA256']:
        raise ValueError('output disk readback mismatch')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
