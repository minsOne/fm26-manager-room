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
        clubs = list(career.clubs())

    ca_sum = sum(int(player.ability.current) for player in players)
    pa_raw_sum = 0
    for player in players:
        if player.ability.potential is not None:
            pa_raw_sum += int(player.ability.potential)
        elif player.ability.potential_range_code is not None:
            pa_raw_sum += int(player.ability.potential_range_code)

    decoded_people = [player for player in players if player.personality is not None]
    name_hash = 0xCBF29CE484222325
    for player in decoded_people:
        if player.name is None:
            continue
        name_hash = fnv_update(name_hash, int(player.uid).to_bytes(4, "little", signed=False))
        name_hash = fnv_update(name_hash, player.name.encode("utf-8"))
        name_hash = fnv_update(name_hash, b"\xff")

    personality_sums = [0] * 8
    for player in decoded_people:
        personality = player.personality
        values = (
            personality.adaptability,
            personality.ambition,
            personality.loyalty,
            personality.pressure,
            personality.professionalism,
            personality.sportsmanship,
            personality.temperament,
            personality.controversy,
        )
        for index, value in enumerate(values):
            personality_sums[index] += int(value)

    club_name_hash = 0xCBF29CE484222325
    for club in clubs:
        club_name_hash = fnv_update(club_name_hash, int(club.uid).to_bytes(4, "little", signed=False))
        club_name_hash = fnv_update(club_name_hash, club.name.encode("utf-8"))
        club_name_hash = fnv_update(club_name_hash, b"\xff")

    player_club_hash = 0xCBF29CE484222325
    for player in players:
        if player.club_uid is None or player.club_name is None:
            continue
        player_club_hash = fnv_update(
            player_club_hash, int(player.uid).to_bytes(4, "little", signed=False)
        )
        player_club_hash = fnv_update(
            player_club_hash, int(player.club_uid).to_bytes(4, "little", signed=False)
        )
        player_club_hash = fnv_update(player_club_hash, player.club_name.encode("utf-8"))
        player_club_hash = fnv_update(player_club_hash, b"\xff")

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
        "personDecoded": sum(player.name is not None for player in players),
        "nameByteSum": sum(len((player.name or "").encode("utf-8")) for player in players),
        "firstNameByteSum": sum(len((player.first_name or "").encode("utf-8")) for player in players),
        "lastNameByteSum": sum(len((player.last_name or "").encode("utf-8")) for player in players),
        "commonNameByteSum": sum(len((player.common_name or "").encode("utf-8")) for player in players),
        "legalNameByteSum": sum(len((player.legal_name or "").encode("utf-8")) for player in players),
        "ageSum": sum(int(player.age or 0) for player in players),
        "nationIdSum": sum(int(player.nation_id or 0) for player in players),
        "traitBitsXor": __import__("functools").reduce(lambda a, b: a ^ int(b or 0), (player.trait_bits for player in players), 0),
        "personalitySum": sum(sum(astuple(player.personality)) for player in players if player.personality is not None),
        "personDecoded": len(decoded_people),
        "personMissing": len(players) - len(decoded_people),
        "namePresent": sum(1 for player in decoded_people if player.name is not None),
        "nameHashFnv1a64": name_hash,
        "birthYearSum": sum(int(player.birth_date.year) for player in decoded_people if player.birth_date),
        "birthDaySum": sum(int(player.birth_date.strftime("%j")) for player in decoded_people if player.birth_date),
        "nationIdSum": sum(int(player.nation_id or 0) for player in decoded_people),
        "personalitySums": personality_sums,
        "traitBitsXor": xor_values(int(player.trait_bits or 0) for player in decoded_people),
        "traitPopcountSum": sum(int(player.trait_bits or 0).bit_count() for player in decoded_people),
        "clubCount": len(clubs),
        "clubUidSum": sum(int(club.uid) for club in clubs),
        "clubNationSum": sum(int(club.nation_id) for club in clubs),
        "clubNameHashFnv1a64": club_name_hash,
        "teamPresent": sum(1 for player in players if player.team_id is not None),
        "teamResolved": sum(
            1 for player in players if player.team_id is not None and player.club_uid is not None
        ),
        "teamIdSum": sum(int(player.team_id or 0) for player in players),
        "resolvedClubUidSum": sum(int(player.club_uid or 0) for player in players),
        "resolvedClubNationSum": sum(int(player.club_nation_id or 0) for player in players),
        "resolvedClubNameHashFnv1a64": player_club_hash,
        "affiliateRegistrationCount": sum(
            1 for player in players if player.team_club_uid is not None
        ),
    }
    print(json.dumps(report, indent=2))
    return 0


FNV_PRIME = 0x100000001B3
MASK64 = (1 << 64) - 1


def fnv_update(value: int, data: bytes) -> int:
    for byte in data:
        value ^= byte
        value = (value * FNV_PRIME) & MASK64
    return value


def xor_values(values) -> int:
    result = 0
    for value in values:
        result ^= value
    return result


def elapsed_ms(started: float) -> float:
    return (time.perf_counter() - started) * 1000.0


if __name__ == "__main__":
    raise SystemExit(main())
