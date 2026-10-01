use crate::club::ClubIndex;
use memchr::memchr;
use serde::Serialize;

const ROW_BYTES: usize = 49;
const TAG: u8 = 0x01;
const COUNT_OFFSET_BEFORE_HEAD: usize = 4;
const COUNT_MIN: u32 = 3;
const COUNT_MAX: u32 = 1_000;
const SHORT_COUNT_MIN: u32 = 1;
const SHORT_COUNT_MAX: u32 = 2;
const BALANCE_MIN: i32 = -400_000_000;
const BALANCE_MAX: i32 = 2_000_000_000;
const WEEKLY_MAX: u32 = 20_000_000;
const MINIMUM_RECORD_BYTES: usize = 1_500;

const BALANCE_OFFSET: usize = 1;
const TRANSFER_ALLOCATED_OFFSET: usize = 5;
const TRANSFER_REMAINING_OFFSET: usize = 9;
const WAGE_BUDGET_OFFSET: usize = 13;
const WAGE_PAYROLL_OFFSET: usize = 17;
const INCOME_EX_TRANSFERS_OFFSET: usize = 21;
const NET_TRANSFERS_OFFSET: usize = 25;
const WAGE_BILL_OFFSET: usize = 29;
const NET_OFFSET: usize = 33;
const EXPENDITURE_EX_TRANSFERS_OFFSET: usize = 37;
const TOTAL_INCOME_OFFSET: usize = 41;
const TOTAL_EXPENDITURE_OFFSET: usize = 45;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceLatest {
    pub club_uid: u32,
    pub club_name: String,
    pub rows: u32,
    pub balance: i32,
    pub transfer_budget_allocated: i32,
    pub transfer_budget_remaining: i32,
    pub wage_budget_weekly: u32,
    pub wage_payroll_weekly: u32,
    pub income_excluding_transfers: i32,
    pub net_transfers: i32,
    pub wage_bill: i32,
    pub net: i32,
    pub expenditure_excluding_transfers: i32,
    pub total_income: i32,
    pub total_expenditure: i32,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceStats {
    pub clubs_searched: usize,
    pub clubs_with_series: usize,
    pub total_rows: u64,
    pub balance_sum: i64,
    pub transfer_allocated_sum: i64,
    pub transfer_remaining_sum: i64,
    pub wage_budget_sum: u64,
    pub wage_payroll_sum: u64,
    pub net_sum: i64,
    pub tag_hits: u64,
    pub normal_count_candidates: u64,
    pub short_count_candidates: u64,
    pub chains_in_bounds: u64,
    pub row_validation_passes: u64,
}

pub fn read_latest(
    game_db: &[u8],
    clubs: &ClubIndex,
) -> (Vec<FinanceLatest>, FinanceStats) {
    let mut result = Vec::new();
    let mut stats = FinanceStats::default();

    for club in &clubs.clubs {
        if club.record_end <= club.record_start
            || club.record_end - club.record_start < MINIMUM_RECORD_BYTES
        {
            continue;
        }
        stats.clubs_searched += 1;

        let Some((head, row_count)) =
            locate_chain(game_db, club.record_start, club.record_end, &mut stats)
        else {
            continue;
        };

        let latest_at = head + ROW_BYTES * (row_count as usize - 1);
        let Some(row) = read_row(game_db, latest_at) else {
            continue;
        };

        stats.clubs_with_series += 1;
        stats.total_rows += row_count as u64;
        stats.balance_sum += row.balance as i64;
        stats.transfer_allocated_sum += row.transfer_budget_allocated as i64;
        stats.transfer_remaining_sum += row.transfer_budget_remaining as i64;
        stats.wage_budget_sum += row.wage_budget_weekly as u64;
        stats.wage_payroll_sum += row.wage_payroll_weekly as u64;
        stats.net_sum += row.net as i64;

        result.push(FinanceLatest {
            club_uid: club.uid,
            club_name: club.name.clone(),
            rows: row_count,
            balance: row.balance,
            transfer_budget_allocated: row.transfer_budget_allocated,
            transfer_budget_remaining: row.transfer_budget_remaining,
            wage_budget_weekly: row.wage_budget_weekly,
            wage_payroll_weekly: row.wage_payroll_weekly,
            income_excluding_transfers: row.income_excluding_transfers,
            net_transfers: row.net_transfers,
            wage_bill: row.wage_bill,
            net: row.net,
            expenditure_excluding_transfers: row.expenditure_excluding_transfers,
            total_income: row.total_income,
            total_expenditure: row.total_expenditure,
        });
    }

    result.sort_by_key(|row| row.club_uid);
    (result, stats)
}

fn locate_chain(
    game_db: &[u8],
    record_start: usize,
    record_end: usize,
    stats: &mut FinanceStats,
) -> Option<(usize, u32)> {
    if record_end > game_db.len()
        || record_start >= record_end
        || record_end - record_start < MINIMUM_RECORD_BYTES
    {
        return None;
    }

    let mut position = record_start.saturating_add(COUNT_OFFSET_BEFORE_HEAD);
    let mut first_normal = None;
    let mut first_short = None;

    while position < record_end {
        let relative = memchr(TAG, game_db.get(position..record_end)?)?;
        let head = position + relative;
        stats.tag_hits += 1;

        let Some(count_at) = head.checked_sub(COUNT_OFFSET_BEFORE_HEAD) else {
            position = head + 1;
            continue;
        };
        if count_at < record_start {
            position = head + 1;
            continue;
        }

        let Some(row_count) = read_u32(game_db, count_at) else {
            position = head + 1;
            continue;
        };
        if (COUNT_MIN..=COUNT_MAX).contains(&row_count) {
            stats.normal_count_candidates += 1;
        } else if (SHORT_COUNT_MIN..=SHORT_COUNT_MAX).contains(&row_count) {
            stats.short_count_candidates += 1;
        }

        let Some(chain_bytes) = ROW_BYTES.checked_mul(row_count as usize) else {
            position = head + 1;
            continue;
        };
        let Some(chain_end) = head.checked_add(chain_bytes) else {
            position = head + 1;
            continue;
        };
        if chain_end > record_end {
            position = head + 1;
            continue;
        }
        stats.chains_in_bounds += 1;

        if (COUNT_MIN..=COUNT_MAX).contains(&row_count) {
            if rows_check_out(game_db, head, chain_end, false) {
                stats.row_validation_passes += 1;
                if first_normal.is_none() {
                    first_normal = Some((head, row_count));
                }
                position = chain_end;
                continue;
            }
        } else if first_short.is_none()
            && (SHORT_COUNT_MIN..=SHORT_COUNT_MAX).contains(&row_count)
            && rows_check_out(game_db, head, chain_end, true)
        {
            stats.row_validation_passes += 1;
            first_short = Some((head, row_count));
        }

        position = head + 1;
    }

    first_normal.or(first_short)
}

fn rows_check_out(
    game_db: &[u8],
    head: usize,
    chain_end: usize,
    balanced: bool,
) -> bool {
    let mut money_moved = !balanced;
    let mut at = head;
    while at < chain_end {
        let Some(row) = read_row(game_db, at) else {
            return false;
        };
        if game_db.get(at).copied() != Some(TAG)
            || !(BALANCE_MIN..=BALANCE_MAX).contains(&row.balance)
            || row.wage_budget_weekly > WEEKLY_MAX
            || row.wage_payroll_weekly > WEEKLY_MAX
        {
            return false;
        }

        if balanced {
            if row.net != row.total_income.saturating_sub(row.total_expenditure)
                || row.expenditure_excluding_transfers < 0
                || row.expenditure_excluding_transfers > row.total_expenditure
                || row.income_excluding_transfers < 0
                || row.income_excluding_transfers > row.total_income
            {
                return false;
            }
            money_moved |= row.total_income != 0 || row.total_expenditure != 0;
        }
        at += ROW_BYTES;
    }
    money_moved
}

#[derive(Debug, Clone, Copy)]
struct FinanceRow {
    balance: i32,
    transfer_budget_allocated: i32,
    transfer_budget_remaining: i32,
    wage_budget_weekly: u32,
    wage_payroll_weekly: u32,
    income_excluding_transfers: i32,
    net_transfers: i32,
    wage_bill: i32,
    net: i32,
    expenditure_excluding_transfers: i32,
    total_income: i32,
    total_expenditure: i32,
}

fn read_row(game_db: &[u8], at: usize) -> Option<FinanceRow> {
    if at.checked_add(ROW_BYTES)? > game_db.len() {
        return None;
    }
    Some(FinanceRow {
        balance: read_i32(game_db, at + BALANCE_OFFSET)?,
        transfer_budget_allocated: read_i32(game_db, at + TRANSFER_ALLOCATED_OFFSET)?,
        transfer_budget_remaining: read_i32(game_db, at + TRANSFER_REMAINING_OFFSET)?,
        wage_budget_weekly: read_u32(game_db, at + WAGE_BUDGET_OFFSET)?,
        wage_payroll_weekly: read_u32(game_db, at + WAGE_PAYROLL_OFFSET)?,
        income_excluding_transfers: read_i32(game_db, at + INCOME_EX_TRANSFERS_OFFSET)?,
        net_transfers: read_i32(game_db, at + NET_TRANSFERS_OFFSET)?,
        wage_bill: read_i32(game_db, at + WAGE_BILL_OFFSET)?,
        net: read_i32(game_db, at + NET_OFFSET)?,
        expenditure_excluding_transfers: read_i32(
            game_db,
            at + EXPENDITURE_EX_TRANSFERS_OFFSET,
        )?,
        total_income: read_i32(game_db, at + TOTAL_INCOME_OFFSET)?,
        total_expenditure: read_i32(game_db, at + TOTAL_EXPENDITURE_OFFSET)?,
    })
}

fn read_u32(buffer: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        buffer.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn read_i32(buffer: &[u8], offset: usize) -> Option<i32> {
    Some(i32::from_le_bytes(
        buffer.get(offset..offset + 4)?.try_into().ok()?,
    ))
}
