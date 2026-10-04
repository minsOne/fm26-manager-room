#!/usr/bin/env python3
"""Compare the *published managed-squad snapshot*, per UID and named field.

This checks equivalence to a pinned reverse-engineered reference, not FM ground
truth. Reports intentionally omit names, paths, attribute values and raw saves.
Importing this module or running its unit tests does not require fmsave.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from dataclasses import asdict
from datetime import date
from pathlib import Path
from typing import Any

REFERENCE_COMMIT = "97ac7fe5991fa93f05e42e32f02f37e4c1874d61"
MISSING = object()
POSITION_MAP = {
    "GK": "GK", "SW": "CB", "DL": "LB", "DC": "CB", "DR": "RB", "DM": "DM",
    "ML": "LW", "MC": "CM", "MR": "RW", "AML": "LW", "AMC": "AM", "AMR": "RW",
    "STC": "ST", "WBL": "LB", "WBR": "RB",
}
HIDDEN_NAMES = ("dirtiness", "consistency", "important_matches", "injury_proneness", "versatility")
MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024


def camel(name: str) -> str:
    first, *rest = name.split("_")
    return first + "".join(part[:1].upper() + part[1:] for part in rest)


def full_months(start: date, end: date) -> int:
    return max(0, (end.year - start.year) * 12 + end.month - start.month - (end.day < start.day))


def reference_player(player: Any, clock: date) -> dict[str, Any]:
    """Use fmsave's *named* fields, never mirror the Rust byte-offset catalogue."""
    attributes = {camel(k): v for k, v in asdict(player.attributes).items()}
    raw_positions = {name.upper(): value for name, value in asdict(player.positions).items()}
    ranked = sorted(enumerate(raw_positions.items()), key=lambda x: (-x[1][1], x[0]))
    positions = list(dict.fromkeys(POSITION_MAP[name] for _, (name, rating) in ranked if rating >= 15))
    personality = getattr(player, "personality", None)
    hidden = {} if personality is None else {camel(k): v for k, v in asdict(personality).items()}
    hidden.update({camel(name): getattr(player.attributes, name) for name in HIDDEN_NAMES})
    contract = player.contract
    wage = contract.wage if contract is not None else None
    end = contract.end if contract is not None else None
    status = contract.squad_status if contract is not None else None
    potential = player.ability.potential
    pa_known = potential is not None and potential > 0
    raw_condition = player.raw_condition
    raw_sharpness = player.raw_match_sharpness
    return {
        "id": str(player.uid),
        "name": player.name or f"Player {player.uid}",
        "age": player.age if player.age is not None else 0,
        "ageKnown": player.birth_date is not None,
        "birthDate": player.birth_date.isoformat() if player.birth_date else None,
        "nationality": str(player.nation_id) if player.nation_id is not None else "",
        "primaryPosition": positions[0] if positions else "CM",  # legacy schema-2 placeholder
        "positions": positions,
        "positionRatings": raw_positions,
        "ca": player.ability.current,
        "pa": potential if pa_known else player.ability.current,
        "paKnown": pa_known,
        "paRangeCode": player.ability.potential_range_code,
        "value": player.transfer_value or 0,
        "valueKnown": player.transfer_value is not None,
        "wage": wage if wage is not None else 0,
        "wageKnown": wage is not None,
        "attributes": attributes,
        "hidden": hidden,
        "personalityKnown": personality is not None,
        "rawLeftFoot": player.raw_left_foot,
        "rawRightFoot": player.raw_right_foot,
        "leftFoot": player.left_foot,
        "rightFoot": player.right_foot,
        "fitness": {
            "rawCondition": raw_condition,
            "condition": min(100, (raw_condition + 50) // 100),
            "conditionKnown": raw_condition <= 10000,
            "rawMatchSharpness": raw_sharpness,
            "matchSharpness": min(100, (raw_sharpness + 50) // 100),
            "matchSharpnessKnown": raw_sharpness <= 10000,
            "fatigueKnown": False,
            "injuryRiskKnown": False,
        },
        "contract": {
            "weeklyWage": wage if wage is not None else 0,
            "weeklyWageKnown": wage is not None,
            "end": end.isoformat() if end else None,
            "monthsRemaining": full_months(clock, end) if end else None,
            "squadStatusRaw": status.raw if status is not None else None,
        },
    }


def reference_match_history(rows: list[Any], clock: date) -> dict[int, dict[str, Any]]:
    """Named fmsave records only; keep unknown stats and incomplete retained scope explicit."""
    by_player: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row.date <= clock:
            by_player[row.player_uid].append({
                "date": row.date.isoformat(), "opponentTeamId": row.opponent_team_id,
                "competitionId": row.competition_id,
                "minutes": row.minutes if row.has_stats else None,
                "minutesKnown": bool(row.has_stats and row.minutes is not None),
            })
    result = {}
    for uid, matches in by_player.items():
        # Stable explicit field ordering: date descending, identity and nullable minute ascending.
        matches.sort(key=lambda row: (row["opponentTeamId"],row["competitionId"],-1 if row["minutes"] is None else row["minutes"]))
        matches.sort(key=lambda row: row["date"], reverse=True)
        result[uid] = {"matches": matches, "matchesKnown": bool(matches),
                       "historyComplete": False, "minutesInterpretationVerified": False}
    return result


def empty_match_history() -> dict[str, Any]:
    return {"matches": [], "matchesKnown": False, "historyComplete": False,
            "minutesInterpretationVerified": False}


def read_reference(save: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    import fmsave  # pinned by workflow; lazy for offline regression tests
    with fmsave.open(save) as career:
        clock = career.info.game_date
        if clock is None:
            raise ValueError("reference_game_date_unavailable")
        managers = list(career.managed_clubs())
        if len(managers) != 1:
            raise ValueError("reference_requires_exactly_one_managed_club")
        managed = managers[0]
        squad = [p for p in career.players() if p.club_uid == managed.club_uid]
        histories = reference_match_history(list(career.player_match_stats()), clock)
        players = []
        for player in squad:
            published = reference_player(player, clock)
            published["playingTime"] = histories.get(player.uid, empty_match_history())
            players.append(published)
        result = {
            "schemaVersion": 2,
            "source": "rust-native",
            "gameDate": clock.isoformat(),
            "manager": {"clubUid": managed.club_uid, "club": managed.club_name},
            "players": players,
        }
        info = {"referenceCommit": REFERENCE_COMMIT,
                "referenceKnownBuild": bool(career.info.known_build),
                "scope": "managed_squad_published_named_fields",
                "groundTruth": "reference_equivalence_only"}
    return result, info


class Audit:
    def __init__(self) -> None:
        self.checks = 0
        self.failures = 0
        self.groups: Counter[str] = Counter()
        self.failed_groups: Counter[str] = Counter()
        self.examples: list[dict[str, str]] = []

    def check(self, expected: Any, actual: Any, path: str, uid: str = "") -> None:
        if isinstance(expected, dict):
            if not isinstance(actual, dict):
                self.fail(path, "object_missing_or_wrong_type", uid)
                return
            if path in ("attributes", "hidden", "positionRatings") and set(expected) != set(actual):
                self.fail(path, "named_field_set_mismatch", uid)
            for key, value in expected.items():
                self.check(value, actual.get(key, MISSING), f"{path}.{key}".strip("."), uid)
            return
        if isinstance(expected, list) and path.endswith(".matches"):
            if not isinstance(actual, list):
                self.fail(path, "array_missing_or_wrong_type", uid)
                return
            self.check(len(expected), len(actual), path + ".length", uid)
            for index, (left, right) in enumerate(zip(expected, actual)):
                self.check(left, right, f"{path}.{index}", uid)
            return
        self.checks += 1
        group = path.split(".")[0]
        self.groups[group] += 1
        # bool is a subclass of int in Python: equal value is not equal type.
        if type(expected) is not type(actual):
            self.fail(path, "type_or_missing_mismatch", uid)
        elif expected != actual:
            self.fail(path, "value_mismatch", uid)

    def fail(self, path: str, reason: str, uid: str = "") -> None:
        self.failures += 1
        self.failed_groups[path.split(".")[0]] += 1
        if len(self.examples) < 20:
            self.examples.append({"record": hashlib.sha256(uid.encode()).hexdigest()[:12] if uid else "root",
                                  "field": path, "reason": reason})


def index_players(rows: Any, audit: Audit, label: str) -> dict[str, dict[str, Any]]:
    if not isinstance(rows, list):
        audit.fail("players", f"{label}_not_array")
        return {}
    result = {}
    for p in rows:
        if not isinstance(p, dict) or not isinstance(p.get("id"), str) or not p["id"].isascii() or not p["id"].isdigit():
            audit.fail("players", f"{label}_invalid_id")
            continue
        uid = p["id"]
        if str(int(uid)) != uid or int(uid) == 0 or int(uid) >= 2**32:
            audit.fail("players", f"{label}_invalid_id", uid)
        if uid in result:
            audit.fail("players", f"{label}_duplicate_id", uid)
        result[uid] = p
    return result


def compare_snapshots(expected: dict[str, Any], actual: Any) -> dict[str, Any]:
    audit = Audit()
    if not isinstance(actual, dict):
        actual = {}
        audit.fail("snapshot", "root_not_object")
    for field in ("schemaVersion", "source", "gameDate", "manager"):
        audit.check(expected.get(field), actual.get(field, MISSING), field)
    reference = index_players(expected.get("players"), audit, "reference")
    output = index_players(actual.get("players"), audit, "snapshot")
    if not reference:
        audit.fail("players", "empty_reference_would_be_vacuous_success")
    for uid in sorted(reference.keys() - output.keys()):
        audit.fail("players", "missing_player", uid)
    for uid in sorted(output.keys() - reference.keys()):
        audit.fail("players", "extra_player", uid)
    for uid in sorted(reference.keys() & output.keys()):
        audit.check(reference[uid], output[uid], "", uid)
    return {"passed": audit.failures == 0,
            "referencePlayers": len(reference), "snapshotPlayers": len(output),
            "comparedPlayers": len(reference.keys() & output.keys()),
            "fieldChecks": audit.checks, "mismatches": audit.failures,
            "checkedGroups": dict(audit.groups), "failedGroups": dict(audit.failed_groups),
            "examples": audit.examples}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save", required=True, type=Path)
    parser.add_argument("--snapshot", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    # Do not overwrite either input, even if a report path was mistyped.
    if args.report.resolve() in (args.save.resolve(), args.snapshot.resolve()):
        parser.error("report path must not be an input path")
    try:
        if args.snapshot.stat().st_size > MAX_SNAPSHOT_BYTES:
            raise ValueError("snapshot_size_limit")
        expected, info = read_reference(args.save)
        actual = json.loads(args.snapshot.read_text(encoding="utf-8"))
        report = {**info, **compare_snapshots(expected, actual)}
    except Exception as error:
        # Exception messages can contain local paths and player data.
        report = {"passed": False, "errorType": type(error).__name__,
                  "reason": "reference_or_snapshot_read_failed", "referenceCommit": REFERENCE_COMMIT}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
