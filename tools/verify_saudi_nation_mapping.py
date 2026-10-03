#!/usr/bin/env python3
"""Verify the published Saudi nation mapping and finance aggregation.

This is reference equivalence on one public FM26 fixture, not proof of every FM26 build.
The external FM database ids are stable anchors for Al-Hilal and Al-Nassr.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

SAUDI_NATION_ID = 133
ANCHOR_UNIQUE_IDS = {
    102852: "Al-Hilal Saudi Football Club",
    102862: "Al-Nassr Football Club",
}


def capacity(row) -> int:
    return max(0, int(row.transfer_budget_remaining)) + int(row.wage_budget_weekly) * 52


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    report = {
        "passed": False,
        "scope": "saudi_nation_finance_reference_equivalence",
        "nationId": SAUDI_NATION_ID,
        "groundTruth": "reference_equivalence_only",
    }

    try:
        import fmsave

        snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
        groups = snapshot.get("economyGroups")
        if not isinstance(groups, list):
            raise ValueError("snapshot_economy_groups_missing")
        group = next((row for row in groups if row.get("nationId") == SAUDI_NATION_ID), None)
        if not isinstance(group, dict):
            raise ValueError("snapshot_saudi_group_missing")
        if group.get("nationName") != "Saudi Arabia":
            raise ValueError("snapshot_saudi_label_missing")

        with fmsave.open(args.save) as career:
            clubs = list(career.clubs())
            finances = list(career.finances())

        by_uid = {club.uid: club for club in clubs}
        anchors = {
            club.unique_id: club
            for club in clubs
            if club.unique_id in ANCHOR_UNIQUE_IDS
        }
        if set(anchors) != set(ANCHOR_UNIQUE_IDS):
            raise ValueError("reference_saudi_anchor_clubs_missing")
        if any(club.nation_id != SAUDI_NATION_ID for club in anchors.values()):
            raise ValueError("reference_saudi_anchor_nation_mismatch")

        latest = {}
        row_counts = Counter()
        for row in finances:
            row_counts[row.club_uid] += 1
            previous = latest.get(row.club_uid)
            if previous is None or row.month > previous.month:
                latest[row.club_uid] = row

        rows = [
            row for club_uid, row in latest.items()
            if (club := by_uid.get(club_uid)) is not None
            and club.nation_id == SAUDI_NATION_ID
        ]
        if len(rows) < 4:
            raise ValueError("reference_saudi_finance_coverage_too_small")

        expected = {
            "clubsWithFinance": len(rows),
            "financeRows": sum(row_counts[row.club_uid] for row in rows),
            "totalBalance": sum(int(row.balance) for row in rows),
            "transferBudgetAllocated": sum(int(row.transfer_budget_allocated) for row in rows),
            "transferBudgetRemaining": sum(int(row.transfer_budget_remaining) for row in rows),
            "wageBudgetWeekly": sum(int(row.wage_budget_weekly) for row in rows),
            "wagePayrollWeekly": sum(int(row.wage_payroll_weekly) for row in rows),
            "budgetCapacityProxy": sum(capacity(row) for row in rows),
        }

        reputations = [
            int(by_uid[row.club_uid].reputation)
            for row in rows
            if by_uid[row.club_uid].reputation is not None
        ]
        expected["reputationCoverageClubs"] = len(reputations)
        expected["averageReputation"] = (
            (sum(reputations) + len(reputations) // 2) // len(reputations)
            if reputations else None
        )
        expected["sportingPowerProxy"] = (
            min(100, (expected["averageReputation"] + 50) // 100)
            if expected["averageReputation"] is not None else None
        )

        capacities = sorted((capacity(row) for row in rows), reverse=True)
        total_capacity = sum(capacities)
        expected["top4CapacityShare"] = (
            min(100, (sum(capacities[:4]) * 100 + total_capacity // 2) // total_capacity)
            if total_capacity else 0
        )

        for key, value in expected.items():
            if group.get(key) != value:
                raise ValueError(f"snapshot_saudi_{key}_mismatch")

        expected_top = sorted(
            rows,
            key=lambda row: (
                -capacity(row),
                by_uid[row.club_uid].name,
                row.club_uid,
            ),
        )[:5]
        actual_top = group.get("topClubs")
        if not isinstance(actual_top, list) or len(actual_top) != min(5, len(expected_top)):
            raise ValueError("snapshot_saudi_top_clubs_count_mismatch")
        for expected_row, actual in zip(expected_top, actual_top, strict=True):
            club = by_uid[expected_row.club_uid]
            if (
                actual.get("clubUid") != expected_row.club_uid
                or actual.get("clubName") != club.name
                or actual.get("reputation") != club.reputation
                or actual.get("budgetCapacityProxy") != capacity(expected_row)
            ):
                raise ValueError("snapshot_saudi_top_club_mismatch")

        report.update(
            passed=True,
            anchorClubs=len(anchors),
            financeClubs=len(rows),
            reputationCoverage=len(reputations),
            topClubRows=len(expected_top),
        )
    except Exception as error:
        report.update(errorType=type(error).__name__, reason=str(error))

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
