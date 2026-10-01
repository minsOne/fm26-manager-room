use crate::club::ClubIndex;
use crate::contract::{ContractCore, GameDate};
use crate::match_history::RecentMinutes;
use crate::person::PersonCore;
use crate::player_scan::PlayerCandidate;
use serde::Serialize;
use std::collections::BTreeMap;

const RATINGS_OFFSET: usize = 24;
const RATINGS_COUNT: usize = 15;
const ATTRIBUTES_OFFSET: usize = 39;
const ATTRIBUTE_COUNT: usize = 54;
const TRANSFER_VALUE_OFFSET: usize = 93;
const MATCH_SHARPNESS_OFFSET: usize = 106;
const CONDITION_OFFSET: usize = 110;
const LEFT_FOOT_INDEX: usize = 24;
const RIGHT_FOOT_INDEX: usize = 25;
const TRANSFER_PLACEHOLDER: u32 = 300_000_000;
const MISSING: u32 = u32::MAX;

const POSITION_CODES: [&str; 15] = [
    "GK","SW","DL","DC","DR","DM","ML","MC","MR","AML","AMC","AMR","STC","WBL","WBR"
];

const ATTRIBUTE_NAMES: [&str; 52] = [
    "crossing","dribbling","finishing","heading","longShots","marking","offTheBall","passing",
    "penaltyTaking","tackling","vision","handling","aerialReach","commandOfArea","communication",
    "kicking","throwing","anticipation","decisions","oneOnOnes","positioning","reflexes",
    "firstTouch","technique","flair","corners","teamwork","workRate","longThrows","eccentricity",
    "rushingOut","punching","acceleration","freeKickTaking","strength","stamina","pace",
    "jumpingReach","leadership","dirtiness","balance","bravery","consistency","aggression",
    "agility","importantMatches","injuryProneness","versatility","naturalFitness","determination",
    "composure","concentration"
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub meta: SnapshotMeta,
    pub manager: Manager,
    pub formation: Formation,
    pub fixtures: Vec<serde_json::Value>,
    pub players: Vec<PlayerRow>,
    pub external_candidates: Vec<serde_json::Value>,
    pub loan_offers: Vec<serde_json::Value>,
    pub leagues: Vec<serde_json::Value>,
    pub recommendations_history: Vec<serde_json::Value>,
    pub decisions: Vec<serde_json::Value>,
    pub training: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMeta {
    pub source: &'static str,
    pub save_name: String,
    pub game_date: String,
    pub runtime: RuntimeMeta,
    pub coverage: Coverage,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMeta {
    pub platform: &'static str,
    pub connected: bool,
    pub parser: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    pub player_core: &'static str,
    pub person: &'static str,
    pub contracts: &'static str,
    pub recent_minutes: &'static str,
    pub fatigue: &'static str,
    pub fixtures: &'static str,
    pub economy: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manager {
    pub club: String,
    pub club_uid: u32,
    pub philosophy: Philosophy,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Philosophy {
    pub youth_development: u8,
    pub winning_now: u8,
    pub squad_stability: u8,
    pub financial_efficiency: u8,
    pub rotation: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Formation {
    pub id: &'static str,
    pub name: &'static str,
    pub source: &'static str,
    pub slots: Vec<FormationSlot>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormationSlot {
    pub id: &'static str,
    pub position: &'static str,
    pub x: u8,
    pub y: u8,
    pub ip_role: &'static str,
    pub oop_role: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerRow {
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
    pub hidden: Hidden,
    pub playing_time: PlayingTime,
    pub fitness: Fitness,
    pub contract: ContractSummary,
    pub market: Market,
    pub influence: &'static str,
    pub homegrown: bool,
    pub homegrown_known: bool,
    pub snapshots: Vec<AbilitySnapshot>,
    pub raw_left_foot: u8,
    pub raw_right_foot: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hidden {
    pub adaptability: u8,
    pub ambition: u8,
    pub loyalty: u8,
    pub pressure: u8,
    pub professionalism: u8,
    pub sportsmanship: u8,
    pub temperament: u8,
    pub controversy: u8,
    pub consistency: u8,
    pub important_matches: u8,
    pub injury_proneness: u8,
    pub versatility: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayingTime {
    pub agreed: String,
    pub actual: Option<String>,
    pub recent_minutes: u16,
    pub starts_last5: u8,
    pub minutes_last5: u16,
    pub recent_minutes_known: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fitness {
    pub condition: u8,
    pub fatigue: u8,
    pub fatigue_known: bool,
    pub injury_risk: u8,
    pub injury_risk_known: bool,
    pub match_sharpness: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractSummary {
    pub months_remaining: u16,
    pub weekly_wage: u32,
    pub end: Option<String>,
    pub squad_status_raw: Option<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Market {
    pub interest: u8,
    pub interest_known: bool,
    pub transfer_listed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AbilitySnapshot {
    pub date: String,
    pub ca: u16,
}

pub fn build(
    save_name: String,
    game_db: &[u8],
    candidates: &[PlayerCandidate],
    people: &[Option<PersonCore>],
    clubs: &ClubIndex,
    contracts: &[Option<ContractCore>],
    recent_minutes: &[RecentMinutes],
    clock: GameDate,
    managed_club_uid: u32,
) -> Snapshot {
    let club_name = clubs
        .club(managed_club_uid)
        .map(|club| club.name.clone())
        .unwrap_or_else(|| format!("Club {managed_club_uid}"));

    let mut players = Vec::new();
    for (index, candidate) in candidates.iter().enumerate() {
        let player_club = if candidate.team_id == MISSING {
            None
        } else {
            clubs.resolve_team(candidate.team_id).map(|value| value.club_uid)
        };
        if player_club != Some(managed_club_uid) {
            continue;
        }

        let person = people.get(index).and_then(Option::as_ref);
        let contract = contracts.get(index).and_then(Option::as_ref);
        let recent = recent_minutes.get(index).copied().unwrap_or_default();
        players.push(player_row(game_db, candidate, person, contract, recent, clock));
    }

    Snapshot {
        meta: SnapshotMeta {
            source: "rust-save-parser",
            save_name,
            game_date: date_string(clock),
            runtime: RuntimeMeta {
                platform: "macOS",
                connected: false,
                parser: "native-rust",
            },
            coverage: Coverage {
                player_core: "native",
                person: "native",
                contracts: "native",
                recent_minutes: "native-match-history",
                fatigue: "runtime-bridge-required",
                fixtures: "pending-native-fixture-reader",
                economy: "pending-native-finance-reader",
            },
        },
        manager: Manager {
            club: club_name,
            club_uid: managed_club_uid,
            philosophy: Philosophy {
                youth_development: 75,
                winning_now: 75,
                squad_stability: 75,
                financial_efficiency: 65,
                rotation: 75,
            },
        },
        formation: default_formation(),
        fixtures: Vec::new(),
        players,
        external_candidates: Vec::new(),
        loan_offers: Vec::new(),
        leagues: Vec::new(),
        recommendations_history: Vec::new(),
        decisions: Vec::new(),
        training: Vec::new(),
    }
}

fn player_row(
    game_db: &[u8],
    player: &PlayerCandidate,
    person: Option<&PersonCore>,
    contract: Option<&ContractCore>,
    recent: RecentMinutes,
    clock: GameDate,
) -> PlayerRow {
    let positions = positions(game_db, player.record_offset);
    let primary_position = positions.first().cloned().unwrap_or_else(|| "CM".to_owned());
    let attributes = attributes(game_db, player.record_offset);
    let personality = person.map(|value| value.personality).unwrap_or([0; 8]);
    let ca = player.current_ability;
    let pa_known = player.potential_ability >= 0;
    let pa = if pa_known { player.potential_ability as u16 } else { ca };
    let value = transfer_value(game_db, player.record_offset);
    let wage = contract.and_then(|value| value.wage).unwrap_or(0);
    let end = contract.and_then(|value| value.end);
    let age = person
        .map(|value| age_at(clock, value.birth_year, value.birth_day_of_year))
        .unwrap_or(0);
    let condition_raw = read_u16(game_db, player.record_offset + CONDITION_OFFSET).unwrap_or(10000);
    let sharpness_raw = read_u16(game_db, player.record_offset + MATCH_SHARPNESS_OFFSET).unwrap_or(0);
    let attrs = raw_attribute_slice(game_db, player.record_offset);

    PlayerRow {
        id: player.uid.to_string(),
        name: person
            .and_then(|value| value.name.clone())
            .unwrap_or_else(|| format!("Player {}", player.uid)),
        age,
        nationality: person
            .map(|value| value.nation_id.to_string())
            .unwrap_or_default(),
        primary_position,
        positions,
        ca,
        pa,
        pa_known,
        value,
        wage,
        attributes,
        hidden: Hidden {
            adaptability: personality[0],
            ambition: personality[1],
            loyalty: personality[2],
            pressure: personality[3],
            professionalism: personality[4],
            sportsmanship: personality[5],
            temperament: personality[6],
            controversy: personality[7],
            consistency: scaled(raw_attr(attrs, 42)),
            important_matches: scaled(raw_attr(attrs, 45)),
            injury_proneness: scaled(raw_attr(attrs, 46)),
            versatility: scaled(raw_attr(attrs, 47)),
        },
        playing_time: PlayingTime {
            agreed: squad_status(contract.and_then(|value| value.squad_status)).to_owned(),
            actual: None,
            recent_minutes: recent.last14,
            starts_last5: 0,
            minutes_last5: recent.last5,
            recent_minutes_known: recent.known,
        },
        fitness: Fitness {
            condition: ((condition_raw / 100).min(100)) as u8,
            fatigue: 0,
            fatigue_known: false,
            injury_risk: 0,
            injury_risk_known: false,
            match_sharpness: ((sharpness_raw / 100).min(100)) as u8,
        },
        contract: ContractSummary {
            months_remaining: end.map(|date| approximate_months(clock, date)).unwrap_or(99),
            weekly_wage: wage,
            end: end.map(date_string),
            squad_status_raw: contract.and_then(|value| value.squad_status),
        },
        market: Market {
            interest: 0,
            interest_known: false,
            transfer_listed: false,
        },
        influence: "Unknown",
        homegrown: false,
        homegrown_known: false,
        snapshots: vec![AbilitySnapshot {
            date: date_string(clock),
            ca,
        }],
        raw_left_foot: raw_attr(attrs, LEFT_FOOT_INDEX),
        raw_right_foot: raw_attr(attrs, RIGHT_FOOT_INDEX),
    }
}

fn positions(game_db: &[u8], record_offset: usize) -> Vec<String> {
    let ratings = match game_db.get(record_offset + RATINGS_OFFSET..record_offset + RATINGS_OFFSET + RATINGS_COUNT) {
        Some(value) => value,
        None => return vec!["CM".to_owned()],
    };
    let mut ranked: Vec<(u8, usize)> = ratings
        .iter()
        .copied()
        .enumerate()
        .filter_map(|(index, rating)| (rating >= 15).then_some((rating, index)))
        .collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));

    let mut result = Vec::new();
    for (_, index) in ranked {
        let mapped = map_position(POSITION_CODES[index]);
        if !result.iter().any(|existing| existing == mapped) {
            result.push(mapped.to_owned());
        }
    }
    if result.is_empty() {
        result.push("CM".to_owned());
    }
    result
}

fn attributes(game_db: &[u8], record_offset: usize) -> BTreeMap<String, u8> {
    let raw = raw_attribute_slice(game_db, record_offset);
    let mut result = BTreeMap::new();
    let mut field = 0usize;
    for index in 0..ATTRIBUTE_COUNT {
        if index == LEFT_FOOT_INDEX || index == RIGHT_FOOT_INDEX {
            continue;
        }
        if let Some(name) = ATTRIBUTE_NAMES.get(field) {
            result.insert((*name).to_owned(), scaled(raw_attr(raw, index)));
        }
        field += 1;
    }
    result
}

fn raw_attribute_slice(game_db: &[u8], record_offset: usize) -> &[u8] {
    game_db
        .get(record_offset + ATTRIBUTES_OFFSET..record_offset + ATTRIBUTES_OFFSET + ATTRIBUTE_COUNT)
        .unwrap_or(&[])
}

fn raw_attr(raw: &[u8], index: usize) -> u8 {
    raw.get(index).copied().unwrap_or(0)
}

fn scaled(raw: u8) -> u8 {
    ((raw.saturating_add(2)) / 5).max(1)
}

fn transfer_value(game_db: &[u8], record_offset: usize) -> u32 {
    let raw = read_u32(game_db, record_offset + TRANSFER_VALUE_OFFSET).unwrap_or(0);
    if raw == 0 || raw == MISSING || raw == TRANSFER_PLACEHOLDER { 0 } else { raw }
}

fn squad_status(raw: Option<u8>) -> &'static str {
    match raw {
        Some(1) => "Star Player",
        Some(2) => "Important Player",
        Some(3) => "Regular Starter",
        Some(4) => "Squad Player",
        Some(5) => "Impact Sub",
        Some(7) => "Fringe Player",
        Some(10) => "Breakthrough Prospect",
        Some(11) => "Future Prospect",
        Some(13) => "Youngster",
        Some(14) => "B Team Regular",
        Some(15) => "First Choice Goalkeeper",
        Some(16) => "Cup Goalkeeper",
        Some(20) => "Backup",
        Some(22) => "Surplus To Requirements",
        _ => "Unknown",
    }
}

fn age_at(clock: GameDate, birth_year: u16, birth_day: u16) -> u16 {
    clock.year.saturating_sub(birth_year)
        .saturating_sub(u16::from(clock.day_of_year < birth_day))
}

fn approximate_months(start: GameDate, end: GameDate) -> u16 {
    let days = (end.year as i32 - start.year as i32) * 365
        + end.day_of_year as i32 - start.day_of_year as i32;
    if days <= 0 { 0 } else { (days / 30) as u16 }
}

fn date_string(date: GameDate) -> String {
    let leap = date.year % 400 == 0 || (date.year % 4 == 0 && date.year % 100 != 0);
    let month_days = [31u16, if leap {29} else {28}, 31,30,31,30,31,31,30,31,30,31];
    let mut remaining = date.day_of_year.max(1);
    let mut month = 1u8;
    for days in month_days {
        if remaining <= days {
            return format!("{:04}-{:02}-{:02}", date.year, month, remaining);
        }
        remaining -= days;
        month += 1;
    }
    format!("{:04}-12-31", date.year)
}

fn map_position(code: &str) -> &'static str {
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

fn default_formation() -> Formation {
    Formation {
        id: "433",
        name: "4-3-3",
        source: "default-until-native-tactic-reader",
        slots: vec![
            slot("gk","GK",50,92,"Sweeper Keeper","Goalkeeper"),
            slot("lb","LB",14,74,"Wing Back","Full Back"),
            slot("lcb","CB",38,77,"Ball Playing Defender","Central Defender"),
            slot("rcb","CB",62,77,"Central Defender","Central Defender"),
            slot("rb","RB",86,74,"Wing Back","Full Back"),
            slot("dm","DM",50,58,"Deep Lying Playmaker","Holding Midfielder"),
            slot("lcm","CM",35,45,"Central Midfielder","Central Midfielder"),
            slot("rcm","CM",65,45,"Advanced Playmaker","Central Midfielder"),
            slot("lw","LW",18,26,"Inside Forward","Winger"),
            slot("rw","RW",82,26,"Winger","Winger"),
            slot("st","ST",50,12,"Advanced Forward","Pressing Forward"),
        ],
    }
}

fn slot(id:&'static str, position:&'static str, x:u8, y:u8, ip:&'static str, oop:&'static str) -> FormationSlot {
    FormationSlot { id, position, x, y, ip_role: ip, oop_role: oop }
}

fn read_u16(buffer: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(buffer.get(offset..offset + 2)?.try_into().ok()?))
}
fn read_u32(buffer: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(buffer.get(offset..offset + 4)?.try_into().ok()?))
}
