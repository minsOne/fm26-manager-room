#!/usr/bin/env python3
"""Verify native nation-finance aggregation against pinned fmsave.

The public fixture does not necessarily load every nation's finance history. Therefore the
test compares every nation group that *is* covered by the fixture. Saudi-specific assertions
run only when Saudi finance/anchor data is present. This is reference equivalence, not FM ground truth.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

ANCHOR_UNIQUE_IDS = {102852, 102862}  # Al-Hilal, Al-Nassr FM database Unique IDs.


def capacity(row) -> int:
    return max(0, int(row.transfer_budget_remaining)) + int(row.wage_budget_weekly) * 52


def group_reference(clubs, finances):
    by_uid = {club.uid: club for club in clubs}
    latest = {}
    row_counts = Counter()
    for row in finances:
        row_counts[row.club_uid] += 1
        previous = latest.get(row.club_uid)
        if previous is None or row.month > previous.month:
            latest[row.club_uid] = row

    grouped = defaultdict(list)
    for club_uid, row in latest.items():
        club = by_uid.get(club_uid)
        if club is not None:
            grouped[int(club.nation_id)].append(row)

    result = {}
    for nation_id, rows in grouped.items():
        reputations = [
            int(by_uid[row.club_uid].reputation)
            for row in rows
            if by_uid[row.club_uid].reputation is not None
        ]
        capacities = sorted((capacity(row) for row in rows), reverse=True)
        total_capacity = sum(capacities)
        average_reputation = (
            (sum(reputations) + len(reputations) // 2) // len(reputations)
            if reputations else None
        )
        ordered = sorted(
            rows,
            key=lambda row: (
                -capacity(row),
                by_uid[row.club_uid].name,
                row.club_uid,
            ),
        )[:5]
        result[nation_id] = {
            "clubsWithFinance": len(rows),
            "financeRows": sum(row_counts[row.club_uid] for row in rows),
            "totalBalance": sum(int(row.balance) for row in rows),
            "transferBudgetAllocated": sum(int(row.transfer_budget_allocated) for row in rows),
            "transferBudgetRemaining": sum(int(row.transfer_budget_remaining) for row in rows),
            "wageBudgetWeekly": sum(int(row.wage_budget_weekly) for row in rows),
            "wagePayrollWeekly": sum(int(row.wage_payroll_weekly) for row in rows),
            "budgetCapacityProxy": total_capacity,
            "top4CapacityShare": (
                min(100, (sum(capacities[:4]) * 100 + total_capacity // 2) // total_capacity)
                if total_capacity else 0
            ),
            "reputationCoverageClubs": len(reputations),
            "averageReputation": average_reputation,
            "sportingPowerProxy": (
                min(100, (average_reputation + 50) // 100)
                if average_reputation is not None else None
            ),
            "topClubs": [
                {
                    "clubUid": row.club_uid,
                    "clubName": by_uid[row.club_uid].name,
                    "reputation": by_uid[row.club_uid].reputation,
                    "budgetCapacityProxy": capacity(row),
                }
                for row in ordered
            ],
        }
    return result, by_uid


def compare_group(expected, actual, nation_id):
    for key in [
        "clubsWithFinance", "financeRows", "totalBalance",
        "transferBudgetAllocated", "transferBudgetRemaining",
        "wageBudgetWeekly", "wagePayrollWeekly", "budgetCapacityProxy",
        "top4CapacityShare", "reputationCoverageClubs",
        "averageReputation", "sportingPowerProxy",
    ]:
        if actual.get(key) != expected[key]:
            raise ValueError(f"nation_{nation_id}_{key}_mismatch")

    actual_top = actual.get("topClubs")
    if not isinstance(actual_top, list) or len(actual_top) != len(expected["topClubs"]):
        raise ValueError(f"nation_{nation_id}_top_clubs_count_mismatch")
    for wanted, got in zip(expected["topClubs"], actual_top, strict=True):
        for key, value in wanted.items():
            if got.get(key) != value:
                raise ValueError(f"nation_{nation_id}_top_club_{key}_mismatch")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    report = {
        "passed": False,
        "scope": "nation_finance_reference_equivalence",
        "groundTruth": "reference_equivalence_only",
    }

    try:
        import fmsave

        snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
        actual_rows = snapshot.get("economyGroups")
        if not isinstance(actual_rows, list):
            raise ValueError("snapshot_economy_groups_missing")
        actual = {row.get("nationId"): row for row in actual_rows if isinstance(row, dict)}
        if len(actual) != len(actual_rows):
            raise ValueError("snapshot_economy_group_id_invalid_or_duplicate")

        with fmsave.open(args.save) as career:
            clubs = list(career.clubs())
            finances = list(career.finances())

        expected, by_uid = group_reference(clubs, finances)
        if set(actual) != set(expected):
            raise ValueError("nation_group_id_set_mismatch")
        for nation_id, group in expected.items():
            compare_group(group, actual[nation_id], nation_id)

        anchors = {
            club.unique_id: club
            for club in clubs
            if club.unique_id in ANCHOR_UNIQUE_IDS
        }
        anchor_nations = sorted({int(club.nation_id) for club in anchors.values()})
        inferred_saudi_id = None
        if len(anchors) == len(ANCHOR_UNIQUE_IDS):
            if len(anchor_nations) != 1:
                raise ValueError("reference_saudi_anchor_nation_mismatch")
            inferred_saudi_id = anchor_nations[0]

        labeled = [row for row in actual.values() if row.get("nationName") == "Saudi Arabia"]
        if inferred_saudi_id is None:
            if labeled:
                raise ValueError("snapshot_saudi_label_without_anchor_evidence")
            saudi = None
        else:
            if len(labeled) > 1:
                raise ValueError("snapshot_multiple_saudi_labels")
            saudi = actual.get(inferred_saudi_id)
            if saudi is not None and saudi.get("nationName") != "Saudi Arabia":
                raise ValueError("snapshot_saudi_label_missing")
            if saudi is None and labeled:
                raise ValueError("snapshot_saudi_label_wrong_nation")

        report.update(
            passed=True,
            nationGroups=len(expected),
            financeClubs=sum(group["clubsWithFinance"] for group in expected.values()),
            anchorClubsFound=len(anchors),
            anchorNationIds=anchor_nations,
            inferredSaudiNationId=inferred_saudi_id,
            saudiFinanceAvailable=saudi is not None,
            saudiFinanceClubs=0 if saudi is None else saudi["clubsWithFinance"],
        )
    except Exception as error:
        report.update(errorType=type(error).__name__, reason=str(error))

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
