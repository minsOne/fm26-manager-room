#!/usr/bin/env python3
"""Benchmark the fmsave container/index + game_db decompression hot path."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from fmsave._container import read_index, read_section


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("save", type=Path)
    args = parser.parse_args()

    total_started = time.perf_counter()

    started = time.perf_counter()
    index = read_index(args.save)
    index_ms = elapsed_ms(started)

    started = time.perf_counter()
    game_db = read_section(index, "game_db")
    decompress_ms = elapsed_ms(started)

    report = {
        "file": str(args.save),
        "fileBytes": args.save.stat().st_size,
        "saveName": index.save_name,
        "directoryEntries": len(index.entries),
        "sections": len(index.sections),
        "gameDbCompressedBytes": index.sections["game_db"].compressed_size,
        "gameDbDecompressedBytes": len(game_db),
        "indexMs": round(index_ms, 3),
        "decompressGameDbMs": round(decompress_ms, 3),
        "totalMs": round(elapsed_ms(total_started), 3),
    }
    print(json.dumps(report, indent=2))
    return 0


def elapsed_ms(started: float) -> float:
    return (time.perf_counter() - started) * 1000.0


if __name__ == "__main__":
    raise SystemExit(main())
