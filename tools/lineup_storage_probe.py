#!/usr/bin/env python3
"""Read-only FM file inventory/diff. This does not identify or apply a lineup."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import stat


def default_roots():
    home = Path.home()
    return [home / base / 'Sports Interactive/Football Manager 26'
            for base in ('Library/Application Support', 'Documents', 'Public')] + [
        home / 'Library/Preferences/com.SportsInteractive.FootballManager26.plist']


def inventory(roots):
    report = {'schemaVersion': 1, 'roots': [], 'files': {}, 'links': {}, 'errors': [],
              'lineupFormatVerified': False}

    def error(path, exc):
        report['errors'].append({'path': str(path), 'error': str(exc)})

    def visit(path):
        try:
            before = path.lstat()
            if stat.S_ISLNK(before.st_mode):
                report['links'][str(path)] = os.readlink(path)
            elif stat.S_ISDIR(before.st_mode):
                for child in sorted(path.iterdir()):
                    visit(child)
            elif stat.S_ISREG(before.st_mode):
                # Do not follow a symlink substituted between lstat and open.
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                with os.fdopen(fd, 'rb') as source:
                    opened = os.fstat(source.fileno())
                    if not stat.S_ISREG(opened.st_mode) or signature(before) != signature(opened):
                        raise OSError('file changed before reading; repeat capture')
                    digest = hashlib.sha256()
                    for chunk in iter(lambda: source.read(1024 * 1024), b''):
                        digest.update(chunk)
                    after = os.fstat(source.fileno())
                if signature(before) != signature(after) or signature(after) != signature(path.lstat()):
                    raise OSError('file changed during capture; repeat after saving finishes')
                report['files'][str(path)] = {'size': after.st_size,
                    'mtimeNs': after.st_mtime_ns, 'sha256': digest.hexdigest()}
            else:
                raise OSError('not a regular file or directory; skipped')
        except OSError as exc:
            error(path, exc)

    for root in roots:
        # absolute() preserves symlinks so they remain visible and unfollowed.
        root = Path(root).expanduser().absolute()
        report['roots'].append(str(root))
        visit(root)
    return report


def signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def compare(before, after):
    if before.get('schemaVersion') != 1 or after.get('schemaVersion') != 1:
        raise ValueError('unsupported inventory schema')
    if before['roots'] != after['roots']:
        raise ValueError('capture roots differ; compare identical search scopes')
    old, new = before['files'], after['files']
    incomplete = bool(before['errors'] or after['errors'])
    return {'schemaVersion': 1, 'lineupFormatVerified': False,
            'incomplete': incomplete,
            'note': 'Candidates only. Missing files may be unreadable when incomplete is true.',
            'added': sorted(new.keys() - old.keys()),
            'missing': sorted(old.keys() - new.keys()),
            'contentChanged': sorted(p for p in old.keys() & new.keys()
                                     if old[p]['sha256'] != new[p]['sha256']),
            'metadataOnly': sorted(p for p in old.keys() & new.keys()
                                   if old[p]['sha256'] == new[p]['sha256'] and old[p] != new[p]),
            'linksChanged': before['links'] != after['links'],
            'errorsBefore': before['errors'], 'errorsAfter': after['errors']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    capture = commands.add_parser('capture', help='print private inventory JSON to stdout')
    capture.add_argument('--root', action='append', help='explicit FM data root; repeat as needed')
    capture.add_argument('--app', type=Path, help='FM .app bundle to record version metadata')
    diff = commands.add_parser('diff', help='compare captures; never infer a writable format')
    diff.add_argument('before', type=Path)
    diff.add_argument('after', type=Path)
    args = parser.parse_args()
    if args.command == 'capture':
        result = inventory(args.root or default_roots())
        if args.app:
            try:
                with (args.app / 'Contents/Info.plist').open('rb') as source:
                    info = plistlib.load(source)
                result['application'] = {key: info.get(key) for key in (
                    'CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion')}
            except (OSError, plistlib.InvalidFileException, ValueError) as exc:
                result['errors'].append({'path': str(args.app), 'error': str(exc)})
    else:
        result = compare(json.loads(args.before.read_text()), json.loads(args.after.read_text()))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
