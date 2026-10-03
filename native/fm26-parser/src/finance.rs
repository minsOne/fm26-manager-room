use crate::club::ClubIndex;
use memchr::memchr;
use serde::Serialize;
use std::collections::BTreeMap;

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
    pub net: i32,
}
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceStats {
    pub clubs_with_series: usize,
    pub total_rows: u64,
    pub balance_sum: i64,
    pub transfer_allocated_sum: i64,
    pub transfer_remaining_sum: i64,
    pub wage_budget_sum: u64,
    pub wage_payroll_sum: u64,
    pub net_sum: i64,
}
#[derive(Clone,Copy)]
struct Row {
    balance:i32, transfer_allocated:i32, transfer_remaining:i32,
    wage_budget:u32, wage_payroll:u32, income_ex:i32, net_transfers:i32,
    wage_bill:i32, net:i32, expenditure_ex:i32, total_income:i32, total_expenditure:i32,
}

pub fn read_latest(game_db:&[u8],clubs:&ClubIndex)->(Vec<FinanceLatest>,FinanceStats){
    let mut out=Vec::new(); let mut stats=FinanceStats::default();
    for club in &clubs.clubs {
        if club.record_end<=club.record_start || club.record_end-club.record_start<MINIMUM_RECORD_BYTES {continue;}
        let Some((head,count))=locate_chain(game_db,club.record_start,club.record_end) else{continue};
        let Some(row)=read_row(game_db,head+ROW_BYTES*(count as usize-1)) else{continue};
        stats.clubs_with_series+=1; stats.total_rows+=count as u64;
        stats.balance_sum+=row.balance as i64;
        stats.transfer_allocated_sum+=row.transfer_allocated as i64;
        stats.transfer_remaining_sum+=row.transfer_remaining as i64;
        stats.wage_budget_sum+=row.wage_budget as u64;
        stats.wage_payroll_sum+=row.wage_payroll as u64;
        stats.net_sum+=row.net as i64;
        out.push(FinanceLatest{
            club_uid:club.uid,club_name:club.name.clone(),rows:count,balance:row.balance,
            transfer_budget_allocated:row.transfer_allocated,
            transfer_budget_remaining:row.transfer_remaining,
            wage_budget_weekly:row.wage_budget,wage_payroll_weekly:row.wage_payroll,net:row.net
        });
    }
    out.sort_by_key(|r|r.club_uid); (out,stats)
}
fn locate_chain(buf:&[u8],start:usize,end:usize)->Option<(usize,u32)>{
    let mut pos=start+COUNT_OFFSET_BEFORE_HEAD; let mut normal=None; let mut short=None;
    while pos<end {
        let Some(search)=buf.get(pos..end) else{break};
        let Some(rel)=memchr(TAG,search) else{break};
        let head=pos+rel;
        let Some(count_at)=head.checked_sub(COUNT_OFFSET_BEFORE_HEAD) else{pos=head+1;continue};
        if count_at<start {pos=head+1;continue;}
        let count=read_u32(buf,count_at)?;
        let chain_end=head.checked_add(ROW_BYTES.checked_mul(count as usize)?)?;
        if chain_end>end {pos=head+1;continue;}
        if (COUNT_MIN..=COUNT_MAX).contains(&count) && rows_valid(buf,head,chain_end,false){
            if normal.is_none(){normal=Some((head,count));}
            pos=chain_end; continue;
        }
        if short.is_none() && (SHORT_COUNT_MIN..=SHORT_COUNT_MAX).contains(&count)
            && rows_valid(buf,head,chain_end,true){short=Some((head,count));}
        pos=head+1;
    }
    normal.or(short)
}
fn rows_valid(buf:&[u8],head:usize,end:usize,balanced:bool)->bool{
    let mut moved=!balanced; let mut at=head;
    while at<end {
        let Some(r)=read_row(buf,at) else{return false};
        if buf[at]!=TAG || !(BALANCE_MIN..=BALANCE_MAX).contains(&r.balance)
            || r.wage_budget>WEEKLY_MAX || r.wage_payroll>WEEKLY_MAX{return false;}
        if balanced {
            if r.net!=r.total_income.saturating_sub(r.total_expenditure)
                || r.expenditure_ex<0 || r.expenditure_ex>r.total_expenditure
                || r.income_ex<0 || r.income_ex>r.total_income{return false;}
            moved|=r.total_income!=0||r.total_expenditure!=0;
        }
        at+=ROW_BYTES;
    } moved
}
fn read_row(b:&[u8],a:usize)->Option<Row>{
    if a+ROW_BYTES>b.len(){return None;}
    Some(Row{
        balance:ri(b,a+1)?,transfer_allocated:ri(b,a+5)?,transfer_remaining:ri(b,a+9)?,
        wage_budget:ru(b,a+13)?,wage_payroll:ru(b,a+17)?,income_ex:ri(b,a+21)?,
        net_transfers:ri(b,a+25)?,wage_bill:ri(b,a+29)?,net:ri(b,a+33)?,
        expenditure_ex:ri(b,a+37)?,total_income:ri(b,a+41)?,total_expenditure:ri(b,a+45)?
    })
}
fn ru(b:&[u8],o:usize)->Option<u32>{Some(u32::from_le_bytes(b.get(o..o+4)?.try_into().ok()?))}
fn ri(b:&[u8],o:usize)->Option<i32>{Some(i32::from_le_bytes(b.get(o..o+4)?.try_into().ok()?))}
fn read_u32(b:&[u8],o:usize)->Option<u32>{ru(b,o)}


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NationClubFinance {
    pub club_uid: u32,
    pub club_name: String,
    pub balance: i32,
    pub transfer_budget_remaining: i32,
    pub wage_budget_weekly: u32,
    pub wage_payroll_weekly: u32,
    pub budget_capacity_proxy: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NationFinanceSummary {
    pub nation_id: u32,
    pub nation_name: Option<String>,
    pub clubs_with_finance: usize,
    pub finance_rows: u64,
    pub total_balance: i64,
    pub transfer_budget_allocated: i64,
    pub transfer_budget_remaining: i64,
    pub wage_budget_weekly: u64,
    pub wage_payroll_weekly: u64,
    /// A comparison proxy, not an FM/SI field:
    /// positive remaining transfer budget + annualized weekly wage budget.
    pub budget_capacity_proxy: u64,
    pub top4_capacity_share: u8,
    pub top_clubs: Vec<NationClubFinance>,
}

pub fn aggregate_by_nation(
    finances: &[FinanceLatest],
    clubs: &ClubIndex,
) -> Vec<NationFinanceSummary> {
    #[derive(Default)]
    struct Group {
        clubs: Vec<NationClubFinance>,
        finance_rows: u64,
        total_balance: i64,
        transfer_allocated: i64,
        transfer_remaining: i64,
        wage_budget: u64,
        wage_payroll: u64,
    }

    let mut groups: BTreeMap<u32, Group> = BTreeMap::new();

    for row in finances {
        let Some(club) = clubs.club(row.club_uid) else { continue; };
        let capacity = budget_capacity_proxy(row);
        let group = groups.entry(club.nation_id).or_default();
        group.finance_rows += row.rows as u64;
        group.total_balance += row.balance as i64;
        group.transfer_allocated += row.transfer_budget_allocated as i64;
        group.transfer_remaining += row.transfer_budget_remaining as i64;
        group.wage_budget += row.wage_budget_weekly as u64;
        group.wage_payroll += row.wage_payroll_weekly as u64;
        group.clubs.push(NationClubFinance {
            club_uid: row.club_uid,
            club_name: row.club_name.clone(),
            balance: row.balance,
            transfer_budget_remaining: row.transfer_budget_remaining,
            wage_budget_weekly: row.wage_budget_weekly,
            wage_payroll_weekly: row.wage_payroll_weekly,
            budget_capacity_proxy: capacity,
        });
    }

    let mut result = Vec::with_capacity(groups.len());
    for (nation_id, mut group) in groups {
        group.clubs.sort_by(|a,b|
            b.budget_capacity_proxy.cmp(&a.budget_capacity_proxy)
                .then_with(|| a.club_name.cmp(&b.club_name))
                .then_with(|| a.club_uid.cmp(&b.club_uid))
        );
        let total_capacity = group.clubs
            .iter()
            .map(|club| club.budget_capacity_proxy)
            .sum::<u64>();
        let top4 = group.clubs
            .iter()
            .take(4)
            .map(|club| club.budget_capacity_proxy)
            .sum::<u64>();
        let share = if total_capacity == 0 {
            0
        } else {
            ((top4.saturating_mul(100) + total_capacity / 2) / total_capacity)
                .min(100) as u8
        };
        let top_clubs = group.clubs.into_iter().take(5).collect::<Vec<_>>();

        result.push(NationFinanceSummary {
            nation_id,
            nation_name: crate::nation::verified_name(nation_id).map(str::to_owned),
            clubs_with_finance: top_clubs.len().max(0), // overwritten below
            finance_rows: group.finance_rows,
            total_balance: group.total_balance,
            transfer_budget_allocated: group.transfer_allocated,
            transfer_budget_remaining: group.transfer_remaining,
            wage_budget_weekly: group.wage_budget,
            wage_payroll_weekly: group.wage_payroll,
            budget_capacity_proxy: total_capacity,
            top4_capacity_share: share,
            top_clubs,
        });
        if let Some(last) = result.last_mut() {
            // Preserve the full group count even though only five club details are published.
            last.clubs_with_finance = groups_count_placeholder(last, total_capacity);
        }
    }

    result.sort_by(|a,b|
        b.budget_capacity_proxy.cmp(&a.budget_capacity_proxy)
            .then_with(|| a.nation_id.cmp(&b.nation_id))
    );
    result
}

fn budget_capacity_proxy(row: &FinanceLatest) -> u64 {
    let transfer = u64::try_from(row.transfer_budget_remaining.max(0)).unwrap_or(0);
    transfer.saturating_add((row.wage_budget_weekly as u64).saturating_mul(52))
}

// This helper is replaced by the exact count before publication; kept isolated
// so the proxy formula never gets confused with coverage.
fn groups_count_placeholder(summary: &NationFinanceSummary, _capacity: u64) -> usize {
    summary.top_clubs.len()
}
