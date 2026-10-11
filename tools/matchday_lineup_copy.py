#!/usr/bin/env python3
"""Guarded matchday copy writer. Only the exact locally verified baseline is supported."""
import json
import os
import shutil
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import uuid

from experiment_lineup_copy import reconstruct_tactics, sha

# This is an evidence profile for one save, NOT a generic FM version offset.
SOURCE_SHA = '5694b8669bc31338ed8b9df49d2d4ec7cfb9ee9a2d2418c6c13a6870ab16bbef'
OFFSET = 1810783
SLOTS = ['gk', 'rb', 'rcb', 'lcb', 'lb', 'rdm', 'ldm', 'rw', 'am', 'lw', 'st']
REFS = [18203, 38492, 42202, 23558, 11692, 48686, 28394, 14765, 22222, 34949,
        14606, 13358, 12159, 38334, 33408, 12410, 38587, 23471, 36483, 36697] + [0xffffffff] * 6


def selection(request, players, references):
    if request.get('formation') != '4-2-3-1':
        raise ValueError('현재 검증된 포메이션은 4-2-3-1입니다. 게임 전술과 맞춰 주세요.')
    lineup, bench = request.get('lineup'), request.get('bench')
    if not isinstance(lineup, dict) or set(lineup) != set(SLOTS) or not isinstance(bench, list) or len(bench) != 9:
        raise ValueError('선발 11명과 벤치 9명이 모두 필요합니다.')
    ids = [lineup[s] for s in SLOTS] + bench
    if any(not isinstance(uid, str) for uid in ids) or len(set(ids)) != 20:
        raise ValueError('선수 중복 또는 잘못된 UID입니다.')
    by_id = {p['id']: p for p in players}
    if any(uid not in by_id or uid not in references for uid in ids):
        raise ValueError('현재 구단에서 고유하게 확인된 선수만 지정할 수 있습니다.')
    values = [references[uid] for uid in ids]
    if len(set(values)) != 20 or any(type(v) is not int or not 0 < v < 0xffffffff for v in values):
        raise ValueError('고유 선수 참조를 확인하지 못했습니다.')
    rows = [dict(slot=slot, playerId=uid, name=by_id[uid]['name'])
            for slot, uid in zip(SLOTS + [f'S{i}' for i in range(1, 10)], ids)]
    return values + [0xffffffff] * 6, rows


def patch(data, values):
    if list(struct.unpack_from('<26I', data, OFFSET)) != REFS:
        raise ValueError('검증한 선발 기록과 다릅니다. 적용을 중단합니다.')
    result = data[:OFFSET] + struct.pack('<26I', *values) + data[OFFSET + 104:]
    changes = [i for i, (a, b) in enumerate(zip(data, result)) if a != b]
    if not changes:
        raise ValueError('현재 세이브와 같은 명단입니다.')
    return result, changes


def run(mode, path, reader, request):
    if not shutil.which('zstd'):
        raise ValueError('이 Mac에 선발 파일 생성에 필요한 zstd 실행 파일이 없습니다.')
    path = Path(path)
    if mode not in ('preview', 'create') or path.is_symlink() or not path.is_file():
        raise ValueError('읽을 수 있는 원본 세이브가 필요합니다.')
    source = path.read_bytes()
    if sha(source) != SOURCE_SHA:
        raise ValueError('이 세이브는 선발 저장 구조를 아직 검증하지 않았습니다. 검증된 ManagerRoom-Before-Experiment.fm을 선택하세요. 다른 버전·새 저장은 지원하지 않습니다.')
    if mode == 'create' and request.get('sourceSHA256') != SOURCE_SHA:
        raise ValueError('미리보기 원본과 다릅니다.')
    with tempfile.TemporaryDirectory(prefix='mr-lineup-') as work:
        staged = Path(work) / 'source.fm'
        staged.write_bytes(source)
        def read(command):
            return json.loads(subprocess.check_output([reader, command, str(staged)], timeout=90))
        snapshot = read('snapshot')
        references = read('lineup-player-references')
        values, rows = selection(request, snapshot['players'], references)
        names = {references[p['id']]: p['name'] for p in snapshot['players'] if p['id'] in references}
        for row, ref in zip(rows, REFS):
            row['previousName'] = names.get(ref, '미확인')
        result, report = reconstruct_tactics(source, lambda data: patch(data, values))
        # Full reader snapshot must remain byte-for-byte semantically identical.
        candidate = Path(work) / 'candidate.fm'
        candidate.write_bytes(result)
        verified = json.loads(subprocess.check_output([reader, 'snapshot', str(candidate)], timeout=90))
        if verified != snapshot:
            raise ValueError('선수·일정·경기 결과 스냅샷이 달라져 생성을 중단했습니다.')
    if path.read_bytes() != source:
        raise ValueError('원본 저장이 진행되었습니다. 다시 미리보기를 확인하세요.')
    report.update(rows=rows, formation='4-2-3-1', requiresReload=True, fileCreated=False)
    if mode == 'create':
        output = path.parent / f'ManagerRoom-Lineup-{uuid.uuid4().hex}.fm'
        # Exclusive creation never overwrites any save. Clean up only our partial file.
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(result)
                stream.flush()
                os.fsync(stream.fileno())
            if sha(output.read_bytes()) != report['outputSHA256'] or path.read_bytes() != source:
                raise ValueError('파일 재검증 실패: 원본을 다시 확인하세요.')
        except BaseException:
            output.unlink(missing_ok=True)
            raise
        report.update(fileCreated=True, outputPath=str(output))
    return report


if __name__ == '__main__':
    try:
        request = json.loads(Path(sys.argv[4]).read_text())
        print(json.dumps(run(sys.argv[1], sys.argv[2], sys.argv[3], request), ensure_ascii=False))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
