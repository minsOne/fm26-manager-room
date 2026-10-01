#!/usr/bin/env python3
"""Convert an FM26 .fm save into the Manager Room snapshot schema.

The converter is deliberately conservative:
- values that fmsave cannot establish stay unknown/default rather than being guessed;
- player ability is read-only;
- no save bytes are ever modified.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import defaultdict
from dataclasses import asdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import fmsave


POSITION_CODE_TO_WEB = {
    "GK": "GK",
    "DL": "LB",
    "WBL": "LB",
    "DC": "CB",
    "DR": "RB",
    "WBR": "RB",
    "DM": "DM",
    "ML": "LW",
    "MC": "CM",
    "MR": "RW",
    "AML": "LW",
    "AMC": "AM",
    "AMR": "RW",
    "STC": "ST",
}

POSITION_RATING_FIELDS = [
    ("gk", "GK"),
    ("dl", "LB"),
    ("wbl", "LB"),
    ("dc", "CB"),
    ("dr", "RB"),
    ("wbr", "RB"),
    ("dm", "DM"),
    ("ml", "LW"),
    ("mc", "CM"),
    ("mr", "RW"),
    ("aml", "LW"),
    ("amc", "AM"),
    ("amr", "RW"),
    ("stc", "ST"),
]

ATTRIBUTE_MAP = {
    "crossing": "crossing",
    "dribbling": "dribbling",
    "finishing": "finishing",
    "marking": "marking",
    "off_the_ball": "offTheBall",
    "passing": "passing",
    "tackling": "tackling",
    "vision": "vision",
    "handling": "handling",
    "aerial_reach": "aerialReach",
    "kicking": "kicking",
    "anticipation": "anticipation",
    "decisions": "decisions",
    "one_on_ones": "oneOnOnes",
    "positioning": "positioning",
    "reflexes": "reflexes",
    "first_touch": "firstTouch",
    "technique": "technique",
    "teamwork": "teamwork",
    "work_rate": "workRate",
    "acceleration": "acceleration",
    "strength": "strength",
    "stamina": "stamina",
    "pace": "pace",
    "jumping_reach": "jumpingReach",
    "balance": "balance",
    "agility": "agility",
    "composure": "composure",
}

DEFAULT_FORMATION = {
    "id": "433",
    "name": "4-3-3",
    "source": "default-until-role-bits-are-mapped",
    "slots": [
        slot("gk", "GK", 50, 92, "Sweeper Keeper", "Goalkeeper"),
        slot("lb", "LB", 14, 74, "Wing Back", "Full Back"),
        slot("lcb", "CB", 38, 77, "Ball Playing Defender", "Central Defender"),
        slot("rcb", "CB", 62, 77, "Central Defender", "Central Defender"),
        slot("rb", "RB", 86, 74, "Wing Back", "Full Back"),
        slot("dm", "DM", 50, 58, "Deep Lying Playmaker", "Holding Midfielder"),
        slot("lcm", "CM", 35, 45, "Central Midfielder", "Central Midfielder"),
        slot("rcm", "CM", 65, 45, "Advanced Playmaker", "Central Midfielder"),
        slot("lw", "LW", 18, 26, "Inside Forward", "Winger"),
        slot("rw", "RW", 82, 26, "Winger", "Winger"),
        slot("st", "ST", 50, 12, "Advanced Forward", "Pressing Forward"),
    ],
}


def slot(
    identifier: str,
    position: str,
    x: int,
    y: int,
    ip_role: str,
    oop_role: str,
) -> dict[str, Any]:
    return {
        "id": identifier,
        "position": position,
        "x": x,
        "y": y,
        "ipRole": ip_role,
        "oopRole": oop_role,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("save", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--summary", type=Path)
    parser.add_argument("--candidate-limit", type=int, default=120)
    args = parser.parse_args()

    snapshot, summary = convert(args.save, candidate_limit=args.candidate_limit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.summary:
        args.summary.parent.mkdir(parents=True, exist_ok=True)
        args.summary.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


def convert(path: Path, *, candidate_limit: int) -> tuple[dict[str, Any], dict[str, Any]]:
    with fmsave.open(path) as career:
        info = career.info
        managed = list(career.managed_clubs())
        if not managed:
            raise RuntimeError("The public smoke save has no managed club.")

        managed_club = managed[0]
        club_uid = managed_club.club_uid
        clubs = list(career.clubs())
        club_by_uid = {club.uid: club for club in clubs}

        all_players = list(career.players())
        squad_players = [player for player in all_players if player.club_uid == club_uid]

        finances = list(career.finances())
        fixtures = list(career.fixtures())

        match_stats: list[Any] = []
        try:
            match_stats = list(career.player_match_stats())
        except Exception:
            # Match history is useful but not required to establish a valid snapshot.
            match_stats = []

        tactics: list[Any] = []
        training: list[Any] = []
        try:
            tactics = list(career.tactics())
        except Exception:
            tactics = []
        try:
            training = list(career.training())
        except Exception:
            training = []

        game_date = info.game_date or date.today()
        minutes = recent_minutes(match_stats, game_date)

        players = [
            normalize_player(player, game_date, minutes.get(player.uid))
            for player in squad_players
        ]

        candidates = top_candidates(
            all_players,
            managed_club_uid=club_uid,
            game_date=game_date,
            limit=candidate_limit,
        )

        upcoming = normalize_fixtures(
            fixtures,
            club_uid=club_uid,
            club_by_uid=club_by_uid,
            game_date=game_date,
        )

        leagues = build_market_groups(clubs, finances)

        snapshot = {
            "meta": {
                "source": "fmsave",
                "saveName": info.save_name or info.file_name,
                "fileName": info.file_name,
                "game": info.game,
                "build": info.build,
                "buildNumber": info.build_number,
                "knownBuild": info.known_build,
                "dbVersion": info.db_version,
                "gameDate": game_date.isoformat(),
                "capturedAt": None,
                "runtime": {
                    "platform": "macOS-compatible-save-parser",
                    "connected": False,
                    "build": info.build,
                },
                "coverage": {
                    "recentMinutes": "player_match_stats retained history",
                    "fatigue": "unknown",
                    "currentInjuryRisk": "unknown",
                    "individualTrainingFocus": "unknown",
                    "tacticRoleNames": "unknown; save role bits remain raw",
                    "economy": "finance-budget proxy by nation",
                },
            },
            "manager": {
                "club": managed_club.club_name,
                "name": managed_club.manager_name,
                "clubUid": club_uid,
                "philosophy": {
                    "youthDevelopment": 75,
                    "winningNow": 75,
                    "squadStability": 75,
                    "financialEfficiency": 65,
                    "rotation": 75,
                },
            },
            "formation": DEFAULT_FORMATION,
            "fixtures": upcoming,
            "players": players,
            "externalCandidates": candidates,
            "loanOffers": [],
            "leagues": leagues,
            "recommendationsHistory": [],
            "decisions": [],
            "training": [],
            "sourceData": {
                "financeRows": len(finances),
                "fixtureRows": len(fixtures),
                "matchStatRows": len(match_stats),
                "tacticRows": len(tactics),
                "trainingRows": len(training),
            },
        }

        summary = {
            "game": info.game,
            "build": info.build,
            "knownBuild": info.known_build,
            "gameDate": game_date.isoformat(),
            "managedClub": managed_club.club_name,
            "playersInSave": len(all_players),
            "managedSquadPlayers": len(players),
            "externalCandidates": len(candidates),
            "clubs": len(clubs),
            "finances": len(finances),
            "fixtures": len(fixtures),
            "upcomingManagedFixtures": len(upcoming),
            "playerMatchStats": len(match_stats),
            "tactics": len(tactics),
            "training": len(training),
            "marketGroups": len(leagues),
            "saudiGroupDetected": any(group["id"] == "saudi" for group in leagues),
        }
        return snapshot, summary


def normalize_player(
    player: Any,
    game_date: date,
    minute_window: dict[str, int] | None = None,
) -> dict[str, Any]:
    minute_window = minute_window or {}
    positions = web_positions(player)
    primary = positions[0] if positions else "CM"
    contract = player.contract
    squad_status = code_text(getattr(contract, "squad_status", None)) or "Squad Player"
    wage = int(getattr(contract, "wage", 0) or 0)
    end = getattr(contract, "end", None)

    personality = getattr(player, "personality", None)
    attributes = normalize_attributes(player.attributes)

    hidden = {
        "adaptability": int(getattr(personality, "adaptability", 0) or 0),
        "ambition": int(getattr(personality, "ambition", 0) or 0),
        "loyalty": int(getattr(personality, "loyalty", 0) or 0),
        "pressure": int(getattr(personality, "pressure", 0) or 0),
        "professionalism": int(getattr(personality, "professionalism", 0) or 0),
        "sportsmanship": int(getattr(personality, "sportsmanship", 0) or 0),
        "temperament": int(getattr(personality, "temperament", 0) or 0),
        "controversy": int(getattr(personality, "controversy", 0) or 0),
        "consistency": int(getattr(player.attributes, "consistency", 0) or 0),
        "importantMatches": int(getattr(player.attributes, "important_matches", 0) or 0),
        "injuryProneness": int(getattr(player.attributes, "injury_proneness", 0) or 0),
        "versatility": int(getattr(player.attributes, "versatility", 0) or 0),
        "dirtiness": int(getattr(player.attributes, "dirtiness", 0) or 0),
    }

    potential = player.ability.potential
    if potential is None:
        potential = player.ability.current

    raw_condition = int(getattr(player, "raw_condition", 0) or 0)
    condition = max(0, min(100, round(raw_condition / 100))) if raw_condition else 100

    return {
        "id": str(player.uid),
        "uniqueId": player.unique_id,
        "name": player.name or f"Player {player.uid}",
        "age": player.age or 0,
        "nationality": str(player.nation_id or ""),
        "primaryPosition": primary,
        "positions": positions or [primary],
        "ca": int(player.ability.current),
        "pa": int(potential),
        "paKnown": player.ability.potential is not None,
        "value": int(player.transfer_value or 0),
        "wage": wage,
        "attributes": attributes,
        "hidden": hidden,
        "playingTime": {
            "agreed": squad_status,
            "actual": None,
            "recentMinutes": int(minute_window.get("last14", 0)),
            "startsLast5": 0,
            "minutesLast5": int(minute_window.get("last5", 0)),
            "recentMinutesKnown": bool(minute_window.get("known", 0)),
        },
        "fitness": {
            "condition": condition,
            "fatigue": 0,
            "fatigueKnown": False,
            "injuryRisk": 0,
            "injuryRiskKnown": False,
            "matchSharpness": round(int(getattr(player, "raw_match_sharpness", 0) or 0) / 100),
        },
        "contract": {
            "monthsRemaining": months_between(game_date, end),
            "weeklyWage": wage,
            "end": end.isoformat() if end else None,
        },
        "market": {
            "interest": 0,
            "interestKnown": False,
            "transferListed": False,
        },
        "influence": "Unknown",
        "homegrown": bool(player.home_grown_nation_ids or player.home_grown_club_uids),
        "snapshots": [{"date": game_date.isoformat(), "ca": int(player.ability.current)}],
        "onLoan": player.on_loan,
        "loanParentClub": player.loan_parent_club_name,
    }


def top_candidates(
    players: list[Any],
    *,
    managed_club_uid: int,
    game_date: date,
    limit: int,
) -> list[dict[str, Any]]:
    eligible = [
        player
        for player in players
        if player.club_uid != managed_club_uid
        and (player.age or 99) <= 31
        and player.ability.current >= 90
    ]

    def score(player: Any) -> float:
        potential = player.ability.potential or player.ability.current
        value = player.transfer_value or 0
        age_bonus = max(0, 27 - (player.age or 27)) * 2
        return potential * 1.4 + player.ability.current + age_bonus + math.log10(max(1, value)) * 2

    eligible.sort(key=score, reverse=True)
    return [
        normalize_candidate(player, game_date)
        for player in eligible[: max(0, limit)]
    ]


def normalize_candidate(player: Any, game_date: date) -> dict[str, Any]:
    normalized = normalize_player(player, game_date, None)
    # Candidate cards need less state than managed players but using the same shape
    # makes analysis engines deterministic.
    return normalized


def normalize_attributes(attributes: Any) -> dict[str, int]:
    result: dict[str, int] = {}
    for source, target in ATTRIBUTE_MAP.items():
        result[target] = int(getattr(attributes, source, 0) or 0)
    return result


def web_positions(player: Any) -> list[str]:
    result: list[str] = []
    for code in (*player.natural_positions, *player.accomplished_positions):
        mapped = POSITION_CODE_TO_WEB.get(code)
        if mapped and mapped not in result:
            result.append(mapped)

    if result:
        return result

    rated: list[tuple[int, str]] = []
    for field, mapped in POSITION_RATING_FIELDS:
        rated.append((int(getattr(player.positions, field, 0) or 0), mapped))
    rated.sort(reverse=True)
    for rating, mapped in rated:
        if rating >= 12 and mapped not in result:
            result.append(mapped)
    return result[:4]


def recent_minutes(rows: list[Any], game_date: date) -> dict[int, dict[str, int]]:
    by_player: dict[int, list[Any]] = defaultdict(list)
    for row in rows:
        if row.date <= game_date:
            by_player[row.player_uid].append(row)

    result: dict[int, dict[str, int]] = {}
    cutoff = game_date - timedelta(days=14)

    for player_uid, player_rows in by_player.items():
        player_rows.sort(key=lambda row: row.date, reverse=True)
        last14 = sum(
            int(row.minutes or 0)
            for row in player_rows
            if row.date >= cutoff and row.has_stats
        )
        last5_rows = [row for row in player_rows if row.has_stats][:5]
        last5 = sum(int(row.minutes or 0) for row in last5_rows)
        result[player_uid] = {
            "last14": last14,
            "last5": last5,
            "known": 1 if player_rows else 0,
        }
    return result


def normalize_fixtures(
    fixtures: list[Any],
    *,
    club_uid: int,
    club_by_uid: dict[int, Any],
    game_date: date,
) -> list[dict[str, Any]]:
    rows = [
        fixture
        for fixture in fixtures
        if not fixture.played
        and fixture.date is not None
        and fixture.date >= game_date
        and (fixture.home_club_uid == club_uid or fixture.away_club_uid == club_uid)
    ]
    rows.sort(key=lambda fixture: (fixture.date, fixture.kick_off_time or ""))
    result = []

    for index, fixture in enumerate(rows[:12]):
        home = fixture.home_club_uid == club_uid
        opponent_uid = fixture.away_club_uid if home else fixture.home_club_uid
        opponent_name = fixture.away_club_name if home else fixture.home_club_name
        opponent = club_by_uid.get(opponent_uid)
        reputation = int(getattr(opponent, "reputation", 5000) or 5000)
        strength = max(20, min(100, round(reputation / 100)))
        competition = fixture.competition_name or (
            f"Competition {fixture.competition_id}" if fixture.competition_id is not None else "Unknown competition"
        )

        result.append(
            {
                "id": f"fixture-{index}-{fixture.home_team_id}-{fixture.away_team_id}",
                "date": fixture.date.isoformat(),
                "opponent": opponent_name or "Unknown opponent",
                "competition": competition,
                "home": home,
                "opponentStrength": strength,
                "tableImpact": 55,
                "tableImpactKnown": False,
                "knockout": False,
                "knockoutKnown": False,
                "rivalry": False,
                "rivalryKnown": False,
                "restDaysAfter": rest_days(rows, index),
            }
        )
    return result


def rest_days(fixtures: list[Any], index: int) -> int:
    if index + 1 >= len(fixtures):
        return 7
    current = fixtures[index].date
    upcoming = fixtures[index + 1].date
    if current is None or upcoming is None:
        return 7
    return max(0, (upcoming - current).days)


def build_market_groups(clubs: list[Any], finances: list[Any]) -> list[dict[str, Any]]:
    club_by_uid = {club.uid: club for club in clubs}
    latest: dict[int, Any] = {}
    for row in finances:
        previous = latest.get(row.club_uid)
        if previous is None or row.month > previous.month:
            latest[row.club_uid] = row

    groups: dict[int, list[tuple[Any, Any]]] = defaultdict(list)
    for club_uid, row in latest.items():
        club = club_by_uid.get(club_uid)
        if club is None:
            continue
        groups[int(club.nation_id)].append((club, row))

    raw_groups: list[dict[str, Any]] = []
    total_transfer = sum(max(0, int(row.transfer_budget_remaining)) for row in latest.values()) or 1

    for nation_id, entries in groups.items():
        financial_values = []
        reputations = []
        transfer_sum = 0
        names = []

        for club, row in entries:
            balance = max(0, int(row.balance))
            transfer = max(0, int(row.transfer_budget_remaining))
            weekly_wage = max(0, int(row.wage_budget_weekly))
            financial = balance + transfer * 2 + weekly_wage * 52 * 3
            financial_values.append(financial)
            transfer_sum += transfer
            reputations.append(int(club.reputation or 0))
            names.append((club.name or "").lower())

        group_financial = sum(financial_values)
        top4 = sum(sorted(financial_values, reverse=True)[:4])
        concentration = round(top4 / group_financial * 100) if group_financial else 0
        average_reputation = sum(reputations) / max(1, len(reputations))
        is_saudi = any(
            re.search(r"al[- ]?(hilal|nassr|nasr|ittihad|ahli)", name)
            for name in names
        )
        raw_groups.append(
            {
                "id": "saudi" if is_saudi else f"nation-{nation_id}",
                "name": "Saudi Pro League" if is_saudi else f"Nation {nation_id}",
                "_financialRaw": group_financial,
                "sportingPower": max(0, min(100, round(average_reputation / 100))),
                "spendingShare": round(transfer_sum / total_transfer * 100),
                "wageGrowth": 0,
                "wageGrowthKnown": False,
                "topClubConcentration": concentration,
                "clubCount": len(entries),
                "nationId": nation_id,
            }
        )

    max_financial = max((group["_financialRaw"] for group in raw_groups), default=1) or 1
    for group in raw_groups:
        group["financialPower"] = max(
            5,
            min(100, round(group["_financialRaw"] / max_financial * 100)),
        )
        del group["_financialRaw"]

    return sorted(raw_groups, key=lambda group: group["financialPower"], reverse=True)[:20]


def code_text(value: Any) -> str | None:
    if value is None:
        return None
    text = getattr(value, "label_text", None)
    if text:
        return str(text).replace("_", " ").title()
    label = getattr(value, "label", None)
    name = getattr(label, "name", None)
    return str(name).replace("_", " ").title() if name else None


def months_between(start: date, end: date | None) -> int:
    if end is None:
        return 99
    months = (end.year - start.year) * 12 + end.month - start.month
    if end.day < start.day:
        months -= 1
    return max(0, months)


if __name__ == "__main__":
    raise SystemExit(main())
