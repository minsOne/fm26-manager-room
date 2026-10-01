use crate::club::ClubIndex;
use crate::player_scan::PlayerCandidate;
use memchr::memmem;
use serde::Serialize;

const TAG: &[u8] = &[0x01, 0x00, 0x6c, 0x07];
const CHAIN_WINDOW_OFFSET: usize = 30;
const SELECTOR_OFFSET: usize = 5;
const START_OFFSET_BEFORE_TAG: usize = 19;
const TEAM_ID_OFFSET: usize = 9;
const WAGE_OFFSET: usize = 17;

const TAIL_BASE_OFFSET: usize = 66;
const TAIL_STEP_BYTES: usize = 29;
const TAIL_MAX_EVENT_COUNT: usize = 200;
const TAIL_SIGNATURE_OFFSET: usize = 3;
const TAIL_SIGNATURE: &[u8] = &[0x03, 0x04, 0x00, 0x00, 0x00];
const TAIL_END_OFFSET: usize = 28;
const TAIL_SQUAD_STATUS_OFFSET: usize = 36;
const TAIL_EVENT_COUNT_OFFSET: usize = 42;
const TAIL_MIN_BYTES: usize = 46;

const CLAUSE_STEP_BYTES: usize = 8;
const CLAUSE_MAX_COUNT: usize = 23;
const CLAUSE_FF_OFFSET_BEFORE_BASE: usize = 16;
const CLAUSE_ZERO_OFFSET_BEFORE_BASE: usize = 8;
const CLAUSE_COUNT_OFFSET_BEFORE_BASE: usize = 5;
const HEAD_GATE_OFFSET_BEFORE_BASE: usize = 35;
const HEAD_TYPE_OFFSET_BEFORE_BASE: usize = 33;
const HEAD_GATE_VALUE: u16 = 5;

const FALLBACK_START_FROM_RECORD: usize = 110;
const FALLBACK_END_MARGIN: usize = 90;
const FALLBACK_NONZERO_OFFSET: usize = 8;
const FALLBACK_NONZERO_LENGTH: usize = 8;
const FALLBACK_GATE_LENGTH: usize = 16;

const MISSING: u32 = u32::MAX;
const NONTERMS_BLOCK_PREFIX: &[u8] = &[
    0x00,0x00,0xff,0x00,0x00,0x00,0x00,0x00,0x00,0xff,0x00,0x00,0x00,0x00,
    0xff,0xff,0x00,0x00,0x00,0x00,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,
];
const TAIL_PRINTED_START_OFFSET: usize = 32;
const TAIL_E24_OFFSET: usize = 24;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDate {
    pub year: u16,
    pub day_of_year: u16,
}

impl GameDate {
    pub fn code(self) -> u64 {
        self.year as u64 * 1000 + self.day_of_year as u64
    }
}

#[derive(Debug, Clone)]
struct ChainRecord {
    tag_at: usize,
    club_uid: Option<u32>,
    team_id: u32,
    wage: u32,
    start: Option<GameDate>,
    end: Option<GameDate>,
    has_terms: bool,
    squad_status: Option<u8>,
    event_count: Option<u32>,
    contract_type: Option<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractCore {
    pub club_uid: Option<u32>,
    pub team_id: Option<u32>,
    pub wage: Option<u32>,
    pub start: Option<GameDate>,
    pub end: Option<GameDate>,
    pub squad_status: Option<u8>,
    pub event_count: Option<u32>,
    pub chain_count: usize,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractStats {
    pub contracts: usize,
    pub chain_records: usize,
    pub wage_present: usize,
    pub wage_sum: u64,
    pub start_present: usize,
    pub start_code_sum: u64,
    pub end_present: usize,
    pub end_code_sum: u64,
    pub squad_status_present: usize,
    pub squad_status_sum: u64,
    pub event_count_sum: u64,
    pub team_id_sum: u64,
    pub club_uid_sum: u64,
}

pub fn decode_all(
    game_db: &[u8],
    players: &[PlayerCandidate],
    clubs: &ClubIndex,
    clock: GameDate,
) -> (Vec<Option<ContractCore>>, ContractStats) {
    let mut contracts = Vec::with_capacity(players.len());
    let mut stats = ContractStats::default();

    for (index, player) in players.iter().enumerate() {
        let window_end = players
            .get(index + 1)
            .map(|next| next.record_offset)
            .unwrap_or(game_db.len());
        let player_club_uid = if player.team_id == MISSING {
            None
        } else {
            clubs.resolve_team(player.team_id).map(|value| value.club_uid)
        };

        let contract = decode_one(
            game_db,
            player,
            window_end,
            index + 1 == players.len(),
            player_club_uid,
            clubs,
            clock,
            &mut stats,
        );

        if let Some(value) = &contract {
            stats.contracts += 1;
            if let Some(wage) = value.wage {
                stats.wage_present += 1;
                stats.wage_sum += wage as u64;
            }
            if let Some(start) = value.start {
                stats.start_present += 1;
                stats.start_code_sum += start.code();
            }
            if let Some(end) = value.end {
                stats.end_present += 1;
                stats.end_code_sum += end.code();
            }
            if let Some(status) = value.squad_status {
                stats.squad_status_present += 1;
                stats.squad_status_sum += status as u64;
            }
            stats.event_count_sum += value.event_count.unwrap_or(0) as u64;
            stats.team_id_sum += value.team_id.unwrap_or(0) as u64;
            stats.club_uid_sum += value.club_uid.unwrap_or(0) as u64;
        }

        contracts.push(contract);
    }
    (contracts, stats)
}

fn decode_one(
    game_db: &[u8],
    player: &PlayerCandidate,
    window_end: usize,
    is_last: bool,
    player_club_uid: Option<u32>,
    clubs: &ClubIndex,
    clock: GameDate,
    stats: &mut ContractStats,
) -> Option<ContractCore> {
    let chain = find_chain_records(game_db, player, window_end, is_last, clubs, stats);
    let any_tail = chain.iter().any(|record| record.has_terms);

    let fallback = if chain.is_empty() || !any_tail {
        find_fallback_dates(game_db, player.record_offset, window_end)
    } else {
        (None, None)
    };

    if chain.is_empty() {
        let (fallback_start, fallback_end) = fallback;
        if fallback_start.is_none() && fallback_end.is_none() {
            return None;
        }
        return Some(ContractCore {
            club_uid: None,
            team_id: None,
            wage: None,
            start: fallback_start,
            end: fallback_end.filter(|end| *end >= clock),
            squad_status: None,
            event_count: None,
            chain_count: 0,
        });
    }

    let (fallback_start, fallback_end) = fallback;
    let registration_missing = player.team_id == MISSING;
    let only_retained_nonterms = registration_missing
        && fallback_end.is_none_or(|end| end < clock)
        && chain.iter().all(|record| {
            is_retained_nonterms_block(
                game_db,
                record,
                player.record_offset,
                window_end,
            )
        });
    let in_effect = if only_retained_nonterms {
        None
    } else {
        in_effect_record(&chain, player_club_uid, clock)
    };

    match in_effect {
        None => Some(ContractCore {
            club_uid: None,
            team_id: None,
            wage: None,
            start: None,
            end: if !any_tail {
                fallback_end.filter(|end| *end >= clock)
            } else {
                None
            },
            squad_status: None,
            event_count: None,
            chain_count: chain.len(),
        }),
        Some(record) => Some(ContractCore {
            club_uid: record.club_uid,
            team_id: Some(record.team_id),
            wage: Some(record.wage),
            start: record.start.or(fallback_start),
            end: record.end.or_else(|| {
                if !any_tail {
                    fallback_end.filter(|end| *end >= clock)
                } else {
                    None
                }
            }),
            squad_status: if record.has_terms { record.squad_status } else { None },
            event_count: if record.has_terms { record.event_count } else { None },
            chain_count: chain.len(),
        }),
    }
}

fn find_chain_records(
    game_db: &[u8],
    player: &PlayerCandidate,
    window_end: usize,
    is_last: bool,
    clubs: &ClubIndex,
    stats: &mut ContractStats,
) -> Vec<ChainRecord> {
    let search_start = player.record_offset.saturating_sub(CHAIN_WINDOW_OFFSET);
    let search_end = if is_last {
        window_end
    } else {
        window_end.saturating_sub(CHAIN_WINDOW_OFFSET)
    }
    .max(search_start)
    .min(game_db.len());

    let mut selector = [0u8; 4];
    selector.copy_from_slice(&(player.pindex.saturating_add(1)).to_le_bytes());

    let needle_start = search_start.saturating_add(SELECTOR_OFFSET);
    let needle_end = search_end.saturating_add(SELECTOR_OFFSET).min(game_db.len());
    if needle_start >= needle_end {
        return Vec::new();
    }

    let mut result = Vec::new();
    for relative in memmem::find_iter(&game_db[needle_start..needle_end], &selector) {
        let hit = needle_start + relative;
        let Some(tag_at) = hit.checked_sub(SELECTOR_OFFSET) else {
            continue;
        };
        if tag_at < search_start || tag_at >= search_end {
            continue;
        }

        let normal = game_db.get(tag_at..tag_at + TAG.len()) == Some(TAG);
        let date_marked = !normal && is_date_marked_record(game_db, tag_at, clubs);
        if normal || date_marked {
            if let Some(record) = decode_chain_record(game_db, tag_at, clubs) {
                stats.chain_records += 1;
                result.push(record);
            }
        }
    }
    result
}

fn decode_chain_record(game_db: &[u8], tag_at: usize, clubs: &ClubIndex) -> Option<ChainRecord> {
    let team_id = read_u32(game_db, tag_at.checked_add(TEAM_ID_OFFSET)?)?;
    let wage = read_u32(game_db, tag_at.checked_add(WAGE_OFFSET)?)?;
    let club_uid = clubs.resolve_team(team_id).map(|value| value.club_uid);

    let start = tag_at
        .checked_sub(START_OFFSET_BEFORE_TAG)
        .and_then(|offset| decode_date(game_db, offset));

    let tail_at = locate_tail(game_db, tag_at);
    match tail_at {
        None => Some(ChainRecord {
            tag_at,
            club_uid,
            team_id,
            wage,
            start,
            end: None,
            has_terms: false,
            squad_status: None,
            event_count: None,
            contract_type: None,
        }),
        Some(tail) => {
            let end = decode_date(game_db, tail + TAIL_END_OFFSET);
            let squad_status = game_db.get(tail + TAIL_SQUAD_STATUS_OFFSET).copied();
            let event_count = read_u32(game_db, tail + TAIL_EVENT_COUNT_OFFSET);
            let contract_type = locate_fast_clause_base(game_db, tail)
                .and_then(|base| base.checked_sub(HEAD_GATE_OFFSET_BEFORE_BASE))
                .and_then(|head| {
                    let gate = read_u16(game_db, head)?;
                    if gate != HEAD_GATE_VALUE {
                        return None;
                    }
                    game_db.get(head + (HEAD_GATE_OFFSET_BEFORE_BASE - HEAD_TYPE_OFFSET_BEFORE_BASE)).copied()
                });
            Some(ChainRecord {
                tag_at,
                club_uid,
                team_id,
                wage,
                start,
                end,
                has_terms: true,
                squad_status,
                event_count,
                contract_type,
            })
        }
    }
}

fn locate_tail(game_db: &[u8], tag_at: usize) -> Option<usize> {
    let first = tag_at.checked_sub(TAIL_BASE_OFFSET)?;
    if valid_tail(game_db, first, 0) {
        return Some(first);
    }
    for event_count in 1..=TAIL_MAX_EVENT_COUNT {
        let distance = TAIL_STEP_BYTES.checked_mul(event_count)?;
        let Some(candidate) = first.checked_sub(distance) else {
            break;
        };
        if valid_tail(game_db, candidate, event_count as u32) {
            return Some(candidate);
        }
    }
    None
}

fn valid_tail(game_db: &[u8], at: usize, event_count: u32) -> bool {
    if at + TAIL_MIN_BYTES > game_db.len()
        || game_db.get(at).copied() != Some(0)
        || game_db.get(at + 1).copied() != Some(0)
        || game_db.get(at + TAIL_SIGNATURE_OFFSET..at + TAIL_SIGNATURE_OFFSET + TAIL_SIGNATURE.len())
            != Some(TAIL_SIGNATURE)
    {
        return false;
    }
    read_u32(game_db, at + TAIL_EVENT_COUNT_OFFSET) == Some(event_count)
}

fn locate_fast_clause_base(game_db: &[u8], tail: usize) -> Option<usize> {
    for count in 0..=CLAUSE_MAX_COUNT {
        let base = tail.checked_sub(CLAUSE_STEP_BYTES * count)?;
        let ff_start = base.checked_sub(CLAUSE_FF_OFFSET_BEFORE_BASE)?;
        let zero_start = base.checked_sub(CLAUSE_ZERO_OFFSET_BEFORE_BASE)?;
        let count_at = base.checked_sub(CLAUSE_COUNT_OFFSET_BEFORE_BASE)?;
        if game_db.get(count_at).copied() != Some(count as u8) {
            continue;
        }
        if game_db.get(ff_start..ff_start + 8) != Some(&[0xff; 8])
            || game_db.get(zero_start..zero_start + 3) != Some(&[0; 3])
        {
            continue;
        }
        return Some(base);
    }
    None
}

fn is_date_marked_record(game_db: &[u8], tag_at: usize, clubs: &ClubIndex) -> bool {
    if decode_date(game_db, tag_at).is_none() {
        return false;
    }
    let Some(start_at) = tag_at.checked_sub(START_OFFSET_BEFORE_TAG) else {
        return false;
    };
    if decode_date(game_db, start_at).is_none() {
        return false;
    }
    let Some(team_id) = read_u32(game_db, tag_at + TEAM_ID_OFFSET) else {
        return false;
    };
    clubs.resolve_team(team_id).is_some()
}

fn in_effect_record<'a>(
    records: &'a [ChainRecord],
    player_club_uid: Option<u32>,
    clock: GameDate,
) -> Option<&'a ChainRecord> {
    latest_started(records, player_club_uid, true, clock)
        .or_else(|| latest_started(records, player_club_uid, false, clock))
}

fn latest_started<'a>(
    records: &'a [ChainRecord],
    player_club_uid: Option<u32>,
    with_tail: bool,
    clock: GameDate,
) -> Option<&'a ChainRecord> {
    let mut own: Option<(&ChainRecord, (GameDate, GameDate))> = None;
    let mut latest: Option<(&ChainRecord, (GameDate, GameDate))> = None;
    let mut earliest_running: Option<((GameDate, GameDate), Option<u32>)> = None;
    let mut earliest_filled: Option<((GameDate, GameDate), Option<u32>)> = None;

    for record in records {
        if record.has_terms != with_tail {
            continue;
        }
        let Some(start) = record.start else {
            continue;
        };
        if start > clock {
            continue;
        }
        let end_key = record.end.unwrap_or(start);
        let key = (start, end_key);

        if latest.as_ref().is_none_or(|(_, old)| key > *old) {
            latest = Some((record, key));
        }
        if record.end.is_some_and(|end| end < clock) {
            continue;
        }

        if player_club_uid.is_some() && record.club_uid == player_club_uid {
            if own.as_ref().is_none_or(|(_, old)| key > *old) {
                own = Some((record, key));
            }
            continue;
        }

        if earliest_running.as_ref().is_none_or(|(old, _)| key < *old) {
            earliest_running = Some((key, record.club_uid));
        }
        if !carries_no_contract(record)
            && earliest_filled.as_ref().is_none_or(|(old, _)| key < *old)
        {
            earliest_filled = Some((key, record.club_uid));
        }
    }

    if let Some((record, _)) = own {
        return Some(record);
    }
    if player_club_uid.is_none() || earliest_running.is_none() {
        return latest.map(|value| value.0);
    }

    let chosen_club = earliest_filled
        .map(|value| value.1)
        .or_else(|| earliest_running.map(|value| value.1))?;
    latest_started_at_club(records, chosen_club, with_tail, clock)
}

fn latest_started_at_club(
    records: &[ChainRecord],
    club_uid: Option<u32>,
    with_tail: bool,
    clock: GameDate,
) -> Option<&ChainRecord> {
    let mut chosen: Option<(&ChainRecord, (GameDate, GameDate))> = None;
    for record in records {
        if record.has_terms != with_tail || record.club_uid != club_uid {
            continue;
        }
        let Some(start) = record.start else {
            continue;
        };
        if start > clock || record.end.is_some_and(|end| end < clock) {
            continue;
        }
        let key = (start, record.end.unwrap_or(start));
        if chosen.as_ref().is_none_or(|(_, old)| key > *old) {
            chosen = Some((record, key));
        }
    }
    chosen.map(|value| value.0)
}

fn is_retained_nonterms_block(
    game_db: &[u8],
    record: &ChainRecord,
    record_start: usize,
    record_end: usize,
) -> bool {
    if record.has_terms {
        return false;
    }
    let Some(base) = record.tag_at.checked_sub(TAIL_BASE_OFFSET) else {
        return false;
    };
    if base < record_start {
        return false;
    }
    let needed = [
        NONTERMS_BLOCK_PREFIX.len(),
        TAIL_END_OFFSET + 4,
        TAIL_PRINTED_START_OFFSET + TAG.len(),
        TAIL_EVENT_COUNT_OFFSET + 4,
    ].into_iter().max().unwrap_or(0);
    let Some(block_end) = base.checked_add(needed) else {
        return false;
    };
    if block_end > record_end.min(game_db.len()) {
        return false;
    }
    game_db.get(base..base + NONTERMS_BLOCK_PREFIX.len()) == Some(NONTERMS_BLOCK_PREFIX)
        && game_db.get(base + TAIL_PRINTED_START_OFFSET..base + TAIL_PRINTED_START_OFFSET + TAG.len()) == Some(TAG)
        && read_u32(game_db, base + TAIL_EVENT_COUNT_OFFSET) == Some(0)
        && decode_date(game_db, base + TAIL_END_OFFSET).is_some()
}

fn carries_no_contract(record: &ChainRecord) -> bool {
    record.has_terms
        && record.wage == 0
        && record.end.is_none()
        && record.contract_type.is_none()
}

fn find_fallback_dates(
    game_db: &[u8],
    record_offset: usize,
    window_end: usize,
) -> (Option<GameDate>, Option<GameDate>) {
    let search_start = record_offset.saturating_add(FALLBACK_START_FROM_RECORD);
    let limit = window_end
        .saturating_sub(FALLBACK_END_MARGIN)
        .max(search_start)
        .min(game_db.len());
    if search_start >= limit {
        return (None, None);
    }

    let mut best: Option<(GameDate, GameDate)> = None;
    for relative in memmem::find_iter(&game_db[search_start..limit], &[0xff; 4]) {
        let hit = search_start + relative;
        let dates = hit.saturating_add(8);
        if dates + FALLBACK_GATE_LENGTH > limit
            || dates + FALLBACK_NONZERO_OFFSET + FALLBACK_NONZERO_LENGTH > game_db.len()
        {
            continue;
        }
        if game_db[dates + FALLBACK_NONZERO_OFFSET
            ..dates + FALLBACK_NONZERO_OFFSET + FALLBACK_NONZERO_LENGTH]
            .iter()
            .all(|value| *value == 0)
        {
            continue;
        }
        let Some(end) = decode_date(game_db, dates) else {
            continue;
        };
        let Some(start) = decode_date(game_db, dates + 4) else {
            continue;
        };
        if end <= start {
            continue;
        }
        if best.is_none_or(|(_, best_end)| end > best_end) {
            best = Some((start, end));
        }
    }
    best.map_or((None, None), |(start, end)| (Some(start), Some(end)))
}

pub fn decode_date(buffer: &[u8], offset: usize) -> Option<GameDate> {
    let packed = read_u16(buffer, offset)?;
    let year = read_u16(buffer, offset + 2)?;
    let day = packed & 0x01ff;
    if !(1901..=2200).contains(&year) || !(1..=366).contains(&day) {
        return None;
    }
    Some(GameDate {
        year,
        day_of_year: day,
    })
}

fn read_u16(buffer: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(buffer.get(offset..offset + 2)?.try_into().ok()?))
}
fn read_u32(buffer: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(buffer.get(offset..offset + 4)?.try_into().ok()?))
}


pub fn managed_club_for_selector(
    game_db: &[u8],
    selector: u32,
    clubs: &ClubIndex,
    clock: GameDate,
) -> Option<u32> {
    if selector == 0 || selector == u32::MAX {
        return None;
    }
    let needle = selector.to_le_bytes();
    let mut best: Option<(u32, bool, GameDate)> = None;
    for hit in memmem::find_iter(game_db, &needle) {
        let Some(tag_at) = hit.checked_sub(SELECTOR_OFFSET) else { continue; };
        if game_db.get(tag_at..tag_at + TAG.len()) != Some(TAG) {
            continue;
        }
        let Some(record) = decode_chain_record(game_db, tag_at, clubs) else { continue; };
        let Some(club_uid) = record.club_uid else { continue; };
        if record.end.is_some_and(|end| end < clock) {
            continue;
        }
        let end_rank = record.end.unwrap_or(GameDate { year: 1901, day_of_year: 1 });
        let rank = (record.has_terms, end_rank);
        if best.as_ref().is_none_or(|(_, has_terms, end)| rank > (*has_terms, *end)) {
            best = Some((club_uid, record.has_terms, end_rank));
        }
    }
    best.map(|value| value.0)
}
