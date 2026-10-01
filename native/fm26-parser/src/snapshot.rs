use crate::club::ClubIndex;
use crate::contracts::CurrentContractCore;
use crate::finance::FinanceLatest;
use crate::fixture::FixtureRow;
use crate::match_history::RecentMinutes;
use crate::metadata::{GameDate, SummaryInfo};
use crate::person::PersonCore;
use crate::player_scan::PlayerCandidate;
use serde::Serialize;
use std::collections::BTreeMap;

const MISSING_REFERENCE: u32 = u32::MAX;
const TRANSFER_PLACEHOLDER: u32 = 300_000_000;
const RATINGS_OFFSET: usize = 24;
const RATINGS_COUNT: usize = 15;
const ATTRIBUTES_OFFSET: usize = 39;
const ATTRIBUTE_COUNT: usize = 54;

const POSITION_CODES: [&str; 15] = [
    "GK","SW","DL","DC","DR","DM","ML","MC","MR","AML","AMC","AMR","STC","WBL","WBR",
];

const ATTRIBUTE_NAMES: [&str; 52] = [
    "crossing","dribbling","finishing","heading","longShots","marking","offTheBall","passing",
    "penaltyTaking","tackling","vision","handling","aerialReach","commandOfArea","communication",
    "kicking","throwing","anticipation","decisions","oneOnOnes","positioning","reflexes",
    "firstTouch","technique","flair","corners","teamwork","workRate","longThrows","eccentricity",
    "rushingOut","punching","acceleration","freeKickTaking","strength","stamina","pace",
    "jumpingReach","leadership","dirtiness","balance","bravery","consistency","aggression",
    "agility","importantMatches","injuryProneness","versatility","naturalFitness","determination",
    "composure","concentration",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickSnapshot {
    pub schema_version: u32,
    pub source: &'static str,
    pub save_name: String,
    pub db_version: String,
    pub game_date: String,
    pub manager: QuickManager,
    pub club_finance: Option<QuickClubFinance>,
    pub fixtures: Vec<FixtureRow>,
    pub players: Vec<QuickPlayer>,
    pub coverage: QuickCoverage,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickManager {
    pub name: String,
    pub club: String,
    pub club_uid: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickClubFinance {
    pub balance: i32,
    pub transfer_budget_allocated: i32,
    pub transfer_budget_remaining: i32,
    pub wage_budget_weekly: u32,
    pub wage_payroll_weekly: u32,
    pub finance_rows: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickCoverage {
    pub players: &'static str,
    pub attributes: &'static str,
    pub personality: &'static str,
    pub contracts: &'static str,
    pub fixtures: &'static str,
    pub recent_minutes: &'static str,
    pub finances: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickPlayer {
    pub id: String,
    pub name: String,
    pub age: u16,
    pub nationality: String,
    pub primary_position: String,
    pub positions: Vec<String>,
    pub ca: u16,
    pub pa: u16,
    pub pa_known: bool,
    pub value: u32,
    pub wage: u32,
    pub attributes: BTreeMap<String, u8>,
    pub hidden: BTreeMap<String, u8>,
    pub playing_time: QuickPlayingTime,
    pub fitness: QuickFitness,
    pub contract: QuickContract,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickPlayingTime {
    pub agreed: String,
    pub actual: Option<String>,
    pub recent_minutes: u16,
    pub starts_last5: u8,
    pub minutes_last5: u16,
    pub recent_minutes_known: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickFitness {
    pub condition: u16,
    pub match_sharpness: u16,
    pub fatigue: u8,
    pub fatigue_known: bool,
    pub injury_risk: u8,
    pub injury_risk_known: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickContract {
    pub weekly_wage: u32,
    pub end: Option<String>,
    pub months_remaining: Option<i32>,
    pub squad_status: String,
    pub squad_status_raw: Option<u8>,
}

pub fn build(
    game_db: &[u8],
    save_name: String,
    db_version: String,
    clock: GameDate,
    summary: &SummaryInfo,
    candidates: &[PlayerCandidate],
    people: &[Option<PersonCore>],
    contracts: &[Option<CurrentContractCore>],
    recent_minutes: &[RecentMinutes],
    clubs: &ClubIndex,
    finances: &[FinanceLatest],
    fixtures: Vec<FixtureRow>,
) -> QuickSnapshot {
    let mut players = Vec::new();

    for (index, candidate) in candidates.iter().enumerate() {
        if candidate.team_id == MISSING_REFERENCE {
            continue;
        }
        let Some(resolution) = clubs.resolve_team(candidate.team_id) else {
            continue;
        };
        if resolution.club_uid != summary.club_uid {
            continue;
        }

        let person = people.get(index).and_then(Option::as_ref);
        let contract = contracts.get(index).and_then(Option::as_ref);
        let recent = recent_minutes.get(index).copied().unwrap_or_default();
        players.push(build_player(game_db, candidate, person, contract, recent, clock));
    }

    players.sort_by(|left, right| {
        right.ca.cmp(&left.ca).then_with(|| left.name.cmp(&right.name))
    });

    let club_finance = finances
        .iter()
        .find(|row| row.club_uid == summary.club_uid)
        .map(|row| QuickClubFinance {
            balance: row.balance,
            transfer_budget_allocated: row.transfer_budget_allocated,
            transfer_budget_remaining: row.transfer_budget_remaining,
            wage_budget_weekly: row.wage_budget_weekly,
            wage_payroll_weekly: row.wage_payroll_weekly,
            finance_rows: row.rows,
        });

    QuickSnapshot {
        schema_version: 2,
        source: "rust-native",
        save_name,
        db_version,
        game_date: format_date(clock),
        manager: QuickManager {
            name: summary.manager_name.clone(),
            club: summary.club_name.clone(),
            club_uid: summary.club_uid,
        },
        club_finance,
        fixtures,
        players,
        coverage: QuickCoverage {
            players: "native",
            attributes: "native",
            personality: "native",
            contracts: "native-chain-current",
            fixtures: "native-managed-upcoming",
            recent_minutes: "native-match-history",
            finances: "managed-club-native-finance",
        },
    }
}

fn build_player(
    game_db: &[u8],
    candidate: &PlayerCandidate,
    person: Option<&PersonCore>,
    contract: Option<&CurrentContractCore>,
    recent: RecentMinutes,
    clock: GameDate,
) -> QuickPlayer {
    let ratings = &game_db[
        candidate.record_offset + RATINGS_OFFSET
            ..candidate.record_offset + RATINGS_OFFSET + RATINGS_COUNT
    ];
    let positions = web_positions(ratings);
    let primary_position = positions.first().cloned().unwrap_or_else(|| "CM".to_owned());

    let raw_attrs = &game_db[
        candidate.record_offset + ATTRIBUTES_OFFSET
            ..candidate.record_offset + ATTRIBUTES_OFFSET + ATTRIBUTE_COUNT
    ];
    let attributes = attributes(raw_attrs);
    let hidden = hidden(person, raw_attrs);

    let transfer_raw = read_u32(game_db, candidate.record_offset + 93).unwrap_or(0);
    let value = if matches!(transfer_raw, 0 | MISSING_REFERENCE | TRANSFER_PLACEHOLDER) {
        0
    } else {
        transfer_raw
    };

    let condition = read_u16(game_db, candidate.record_offset + 110)
        .map(|raw| ((raw as f64 / 100.0).round() as u16).min(100))
        .unwrap_or(100);
    let match_sharpness = read_u16(game_db, candidate.record_offset + 106)
        .map(|raw| ((raw as f64 / 100.0).round() as u16).min(100))
        .unwrap_or(0);

    let potential = candidate.potential_ability;
    let pa_known = potential >= 0;
    let pa = if pa_known {
        potential as u16
    } else {
        candidate.current_ability
    };

    let birth = person.map(|value| (value.birth_year, value.birth_day_of_year));
    let age = birth
        .map(|(year, day)| age_at(clock, year, day))
        .unwrap_or(0);

    let contract_end = contract.and_then(|value| value.end);
    let weekly_wage = contract.map(|value| value.wage).unwrap_or(0);
    let agreed = contract
        .and_then(|value| value.squad_status_raw)
        .map(squad_status_label)
        .unwrap_or_else(|| "Unknown".to_owned());

    QuickPlayer {
        id: candidate.uid.to_string(),
        name: person
            .and_then(|value| value.name.clone())
            .unwrap_or_else(|| format!("Player {}", candidate.uid)),
        age,
        nationality: person
            .map(|value| value.nation_id.to_string())
            .unwrap_or_default(),
        primary_position,
        positions,
        ca: candidate.current_ability,
        pa,
        pa_known,
        value,
        wage: weekly_wage,
        attributes,
        hidden,
        playing_time: QuickPlayingTime {
            agreed: agreed.clone(),
            actual: None,
            recent_minutes: recent.last14,
            starts_last5: 0,
            minutes_last5: recent.last5,
            recent_minutes_known: recent.known,
        },
        fitness: QuickFitness {
            condition,
            match_sharpness,
            fatigue: 0,
            fatigue_known: false,
            injury_risk: 0,
            injury_risk_known: false,
        },
        contract: QuickContract {
            weekly_wage,
            end: contract_end.map(format_date),
            months_remaining: contract_end.map(|end| months_between(clock, end)),
            squad_status: agreed,
            squad_status_raw: contract.and_then(|value| value.squad_status_raw),
        },
    }
}

fn attributes(raw: &[u8]) -> BTreeMap<String, u8> {
    ATTRIBUTE_NAMES
        .iter()
        .enumerate()
        .map(|(field_index, name)| {
            let raw_index = if field_index < 24 {
                field_index
            } else {
                field_index + 2
            };
            ((*name).to_owned(), scale(raw[raw_index]))
        })
        .collect()
}

fn hidden(person: Option<&PersonCore>, raw: &[u8]) -> BTreeMap<String, u8> {
    let mut values = BTreeMap::new();
    if let Some(person) = person {
        let names = [
            "adaptability","ambition","loyalty","pressure",
            "professionalism","sportsmanship","temperament","controversy",
        ];
        for (name, value) in names.into_iter().zip(person.personality) {
            values.insert(name.to_owned(), value);
        }
    }

    for (name, raw_index) in [
        ("dirtiness", 41usize),
        ("consistency", 44),
        ("importantMatches", 47),
        ("injuryProneness", 48),
        ("versatility", 49),
    ] {
        values.insert(name.to_owned(), scale(raw[raw_index]));
    }
    values
}

fn web_positions(ratings: &[u8]) -> Vec<String> {
    let mut ranked: Vec<(u8, usize)> = ratings
        .iter()
        .copied()
        .enumerate()
        .filter_map(|(index, rating)| (rating >= 15).then_some((rating, index)))
        .collect();
    ranked.sort_by_key(|(rating, index)| (std::cmp::Reverse(*rating), *index));

    let mut result = Vec::new();
    for (_, index) in ranked {
        let mapped = web_position(POSITION_CODES[index]);
        if !result.iter().any(|existing| existing == mapped) {
            result.push(mapped.to_owned());
        }
    }
    result
}

fn web_position(code: &str) -> &str {
    match code {
        "GK" => "GK",
        "SW" | "DC" => "CB",
        "DL" | "WBL" => "LB",
        "DR" | "WBR" => "RB",
        "DM" => "DM",
        "MC" => "CM",
        "AMC" => "AM",
        "ML" | "AML" => "LW",
        "MR" | "AMR" => "RW",
        "STC" => "ST",
        _ => "CM",
    }
}

fn scale(raw: u8) -> u8 {
    std::cmp::max(1, raw.saturating_add(2) / 5)
}

fn squad_status_label(raw: u8) -> String {
    match raw {
        1 => "Star Player",
        2 => "Important Player",
        3 => "Regular Starter",
        4 => "Squad Player",
        5 => "Impact Sub",
        7 => "Fringe Player",
        9 => "Emergency Backup",
        10 => "Breakthrough Prospect",
        11 => "Future Prospect",
        13 => "Youngster",
        14 => "B Team Regular",
        15 => "First Choice Goalkeeper",
        16 => "Cup Goalkeeper",
        17 => "Domestic Cup Goalkeeper",
        18 => "Continental Cup Goalkeeper",
        20 => "Backup",
        21 => "Goalkeeper Emergency Backup",
        22 => "Surplus To Requirements",
        value => return format!("Unknown ({value})"),
    }
    .to_owned()
}

fn age_at(clock: GameDate, birth_year: u16, birth_day: u16) -> u16 {
    let years = clock.year.saturating_sub(birth_year);
    years.saturating_sub(u16::from(clock.day_of_year < birth_day))
}

fn months_between(start: GameDate, end: GameDate) -> i32 {
    let (start_month, start_day) = month_day(start);
    let (end_month, end_day) = month_day(end);
    let mut months = (end.year as i32 - start.year as i32) * 12
        + end_month as i32
        - start_month as i32;
    if end_day < start_day {
        months -= 1;
    }
    months.max(0)
}

pub fn format_date(value: GameDate) -> String {
    let (month, day) = month_day(value);
    format!("{:04}-{:02}-{:02}", value.year, month, day)
}

fn month_day(value: GameDate) -> (u8, u8) {
    let leap = is_leap(value.year);
    let months = [
        31u16,
        if leap { 29 } else { 28 },
        31,30,31,30,31,31,30,31,30,31,
    ];
    let mut remaining = value.day_of_year;
    for (index, days) in months.into_iter().enumerate() {
        if remaining <= days {
            return ((index + 1) as u8, remaining as u8);
        }
        remaining -= days;
    }
    (12, 31)
}

fn is_leap(year: u16) -> bool {
    let year = year as u32;
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn read_u16(buffer: &[u8], offset: usize) -> Option<u16> {
    let bytes: [u8; 2] = buffer.get(offset..offset + 2)?.try_into().ok()?;
    Some(u16::from_le_bytes(bytes))
}

fn read_u32(buffer: &[u8], offset: usize) -> Option<u32> {
    let bytes: [u8; 4] = buffer.get(offset..offset + 4)?.try_into().ok()?;
    Some(u32::from_le_bytes(bytes))
}
