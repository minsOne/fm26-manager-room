#!/usr/bin/env python3
"""Benchmark fmsave's full player reader and emit lightweight correctness checksums."""

from __future__ import annotations

import argparse
import datetime
import json
import time
from collections import defaultdict
from dataclasses import astuple
from datetime import timedelta
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
        contracts = list(career.contracts())
        game_date = career.info.game_date
        db_version = career.info.db_version
        managed = list(career.managed_clubs())

        started_match_stats = time.perf_counter()
        match_stats = list(career.player_match_stats())
        match_stats_ms = elapsed_ms(started_match_stats)

        started_finances = time.perf_counter()
        finances = list(career.finances())
        finances_ms = elapsed_ms(started_finances)

        started_fixtures = time.perf_counter()
        fixtures = list(career.fixtures())
        fixtures_ms = elapsed_ms(started_fixtures)

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

    chain_contracts = [contract for contract in contracts if contract.chain]
    chain_entries = [entry for contract in chain_contracts for entry in contract.chain]
    current_chain_contracts = [
        contract for contract in chain_contracts if contract.team_id is not None
    ]
    current_terms_contracts = [
        contract for contract in current_chain_contracts if contract.squad_status is not None
    ]

    by_player = defaultdict(list)
    for row in match_stats:
        if game_date is None or row.date <= game_date:
            by_player[row.player_uid].append(row)

    recent_by_uid = {}
    cutoff = game_date - timedelta(days=14) if game_date else None
    for player_uid, rows in by_player.items():
        rows.sort(key=lambda row: row.date, reverse=True)
        last14 = sum(
            int(row.minutes or 0)
            for row in rows
            if row.has_stats and (cutoff is None or row.date >= cutoff)
        )
        last5 = sum(
            int(row.minutes or 0)
            for row in [item for item in rows if item.has_stats][:5]
        )
        recent_by_uid[player_uid] = (last14, last5)

    latest_finance = {}
    finance_row_counts = defaultdict(int)
    for row in finances:
        finance_row_counts[row.club_uid] += 1
        previous = latest_finance.get(row.club_uid)
        if previous is None or row.month > previous.month:
            latest_finance[row.club_uid] = row

    managed_upcoming = []
    if managed and game_date:
        managed_uid = managed[0].club_uid
        managed_upcoming = [
            fixture
            for fixture in fixtures
            if not fixture.played
            and fixture.date is not None
            and fixture.date >= game_date
            and (
                fixture.home_club_uid == managed_uid
                or fixture.away_club_uid == managed_uid
            )
        ]
        managed_upcoming.sort(
            key=lambda fixture: (
                fixture.date,
                fixture.kick_off_time or datetime.time.min,
                fixture.home_team_id,
                fixture.away_team_id,
            )
        )
        managed_upcoming = managed_upcoming[:12]

    fixture_hash = 0xCBF29CE484222325
    for fixture in managed_upcoming:
        home = fixture.home_club_uid == managed[0].club_uid
        opponent_uid = fixture.away_club_uid if home else fixture.home_club_uid
        fixture_hash = fnv_update(
            fixture_hash, date_code(fixture.date).to_bytes(8, "little", signed=False)
        )
        fixture_hash = fnv_update(
            fixture_hash, int(fixture.home_team_id).to_bytes(4, "little", signed=False)
        )
        fixture_hash = fnv_update(
            fixture_hash, int(fixture.away_team_id).to_bytes(4, "little", signed=False)
        )
        fixture_hash = fnv_update(fixture_hash, bytes([1 if home else 0]))
        fixture_hash = fnv_update(
            fixture_hash, int(opponent_uid or 0).to_bytes(4, "little", signed=False)
        )

    managed_players = [
        player for player in players
        if managed and player.club_uid == managed[0].club_uid
    ]
    managed_uid = managed[0].club_uid if managed else None
    managed_finance = latest_finance.get(managed_uid) if managed_uid is not None else None

    managed_name_hash = 0xCBF29CE484222325
    for player in sorted(managed_players, key=lambda player: int(player.uid)):
        if player.name is None:
            continue
        managed_name_hash = fnv_update(
            managed_name_hash, int(player.uid).to_bytes(4, "little", signed=False)
        )
        managed_name_hash = fnv_update(managed_name_hash, player.name.encode("utf-8"))
        managed_name_hash = fnv_update(managed_name_hash, b"\xff")

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
        "gameDateYear": int(game_date.year) if game_date else 0,
        "gameDateDay": int(game_date.strftime("%j")) if game_date else 0,
        "dbVersion": db_version,
        "managedClubUid": int(managed[0].club_uid) if managed else 0,
        "managedClubName": managed[0].club_name if managed else "",
        "managerName": managed[0].manager_name or "" if managed else "",
        "managedPlayerCount": len(managed_players),
        "managedPlayerUidSum": sum(int(player.uid) for player in managed_players),
        "managedPlayerCaSum": sum(int(player.ability.current) for player in managed_players),
        "managedPlayerWageSum": sum(
            int(player.contract.wage or 0)
            for player in managed_players
            if player.contract is not None
        ),
        "managedPlayerNameHashFnv1a64": managed_name_hash,
        "matchStatsMs": round(match_stats_ms, 3),
        "matchStatRows": len(match_stats),
        "matchRowsWithStats": sum(row.has_stats for row in match_stats),
        "recentMinutesKnownPlayers": len(recent_by_uid),
        "recent14Sum": sum(value[0] for value in recent_by_uid.values()),
        "recent5Sum": sum(value[1] for value in recent_by_uid.values()),
        "financesMs": round(finances_ms, 3),
        "financeRows": len(finances),
        "financeLatestClubs": len(latest_finance),
        "financeBalanceSum": sum(int(row.balance) for row in latest_finance.values()),
        "financeTransferAllocatedSum": sum(
            int(row.transfer_budget_allocated) for row in latest_finance.values()
        ),
        "financeTransferRemainingSum": sum(
            int(row.transfer_budget_remaining) for row in latest_finance.values()
        ),
        "financeWageBudgetSum": sum(
            int(row.wage_budget_weekly) for row in latest_finance.values()
        ),
        "financeWagePayrollSum": sum(
            int(row.wage_payroll_weekly) for row in latest_finance.values()
        ),
        "financeNetSum": sum(int(row.net) for row in latest_finance.values()),
        "fixturesMs": round(fixtures_ms, 3),
        "fixtureRows": len(fixtures),
        "managedUpcomingFixtureCount": len(managed_upcoming),
        "managedUpcomingFixtureHash": fixture_hash,
        "managedRecent14Sum": sum(recent_by_uid.get(player.uid, (0, 0))[0] for player in managed_players),
        "managedRecent5Sum": sum(recent_by_uid.get(player.uid, (0, 0))[1] for player in managed_players),
        "managedFinanceBalance": int(managed_finance.balance) if managed_finance else None,
        "managedFinanceTransferAllocated": int(managed_finance.transfer_budget_allocated) if managed_finance else None,
        "managedFinanceTransferRemaining": int(managed_finance.transfer_budget_remaining) if managed_finance else None,
        "managedFinanceWageBudget": int(managed_finance.wage_budget_weekly) if managed_finance else None,
        "managedFinanceWagePayroll": int(managed_finance.wage_payroll_weekly) if managed_finance else None,
        "managedFinanceRows": finance_row_counts.get(managed_uid, 0) if managed_uid is not None else 0,
        "playersWithChain": len(chain_contracts),
        "chainRecords": len(chain_entries),
        "chainTeamsResolved": sum(1 for entry in chain_entries if entry.club_uid is not None),
        "tailsParsed": sum(1 for entry in chain_entries if entry.has_terms),
        "chainWageSum": sum(int(entry.wage) for entry in chain_entries),
        "chainStartDateSum": sum(date_key(entry.start) for entry in chain_entries if entry.start),
        "chainEndDateSum": sum(date_key(entry.end) for entry in chain_entries if entry.end),
        "currentFromChain": len(current_chain_contracts),
        "currentWithTerms": len(current_terms_contracts),
        "currentWageSum": sum(int(contract.wage or 0) for contract in current_chain_contracts),
        "currentEndDateSum": sum(
            date_key(contract.end) for contract in current_chain_contracts if contract.end
        ),
        "currentSquadStatusSum": sum(
            int(contract.squad_status.raw)
            for contract in current_chain_contracts
            if contract.squad_status is not None
        ),
        "currentClubUidSum": sum(
            int(contract.club_uid or 0) for contract in current_chain_contracts
        ),
        "currentTeamIdSum": sum(
            int(contract.team_id or 0) for contract in current_chain_contracts
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


def date_key(value) -> int:
    return int(value.year) * 400 + int(value.strftime("%j"))


def date_code(value) -> int:
    return int(value.year) * 1000 + int(value.strftime("%j"))


def elapsed_ms(started: float) -> float:
    return (time.perf_counter() - started) * 1000.0


if __name__ == "__main__":
    raise SystemExit(main())
