#!/usr/bin/env python3
"""Benchmark fmsave's full player reader and emit lightweight correctness checksums."""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import astuple
from pathlib import Path

import fmsave


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("save", type=Path)
    args = parser.parse_args()

    started = time.perf_counter()
    with fmsave.open(args.save) as career:
        open_ms = elapsed_ms(started)

        started_players = time.perf_counter()
        players = list(career.players())
        players_ms = elapsed_ms(started_players)

    ca_sum = sum(int(player.ability.current) for player in players)
    pa_raw_sum = 0
    for player in players:
        if player.ability.potential is not None:
            pa_raw_sum += int(player.ability.potential)
        elif player.ability.potential_range_code is not None:
            pa_raw_sum += int(player.ability.potential_range_code)

    report = {
        "openMs": round(open_ms, 3),
        "playersMs": round(players_ms, 3),
        "playerCount": len(players),
        "currentAbilitySum": ca_sum,
        "potentialAbilityRawSum": pa_raw_sum,
        "positionRatingSum": sum(sum(astuple(player.positions)) for player in players),
        "rawAttributeSum": sum(sum(astuple(player.raw_attributes)) for player in players),
        "rawLeftFootSum": sum(int(player.raw_left_foot) for player in players),
        "rawRightFootSum": sum(int(player.raw_right_foot) for player in players),
        "transferValueSum": sum(int(player.transfer_value or 0) for player in players),
        "rawMatchSharpnessSum": sum(int(player.raw_match_sharpness) for player in players),
        "rawConditionSum": sum(int(player.raw_condition) for player in players),
        "heightSum": sum(int(player.height_cm) for player in players),
    }
    print(json.dumps(report, indent=2))
    return 0


def elapsed_ms(started: float) -> float:
    return (time.perf_counter() - started) * 1000.0


if __name__ == "__main__":
    raise SystemExit(main())
