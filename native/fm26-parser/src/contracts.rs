use crate::club::ClubIndex;
use crate::metadata::{decode_date_at, GameDate};
use crate::player_scan::PlayerCandidate;
use memchr::memmem;
use serde::Serialize;

const TAG: &[u8] = &[0x01, 0x00, 0x6c, 0x07];
const CHAIN_WINDOW_START: isize = -30;
const CHAIN_WINDOW_END: isize = -30;
const SELECTOR_OFFSET: usize = 5;
const START_OFFSET: isize = -19;
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
const TAIL_STRUCT_END: usize = 46;

const MISSING_REFERENCE: u32 = u32::MAX;

#[derive(Debug, Clone)]
pub struct ChainRecord {
    pub tag_offset: usize,
    pub club_uid: Option<u32>,
    pub team_id: u32,
    pub wage: u32,
    pub start: Option<GameDate>,
    pub end: Option<GameDate>,
    pub has_terms: bool,
    pub squad_status_raw: Option<u8>,
    pub event_count: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractStats {
    pub players_with_chain: usize,
    pub chain_records: usize,
    pub chain_teams_resolved: usize,
    pub tails_parsed: usize,
    pub chain_wage_sum: u64,
    pub chain_start_date_sum: u64,
    pub chain_end_date_sum: u64,
    pub chain_squad_status_sum: u64,
    pub chain_event_count_sum: u64,

    pub current_from_chain: usize,
    pub current_with_terms: usize,
    pub current_wage_sum: u64,
    pub current_end_date_sum: u64,
    pub current_squad_status_sum: u64,
    pub current_club_uid_sum: u64,
    pub current_team_id_sum: u64,
}

pub fn decode_all(
    game_db: &[u8],
    players: &[PlayerCandidate],
    clubs: &ClubIndex,
    clock: GameDate,
) -> ContractStats {
    let mut stats = ContractStats {
        players_with_chain: 0,
        chain_records: 0,
        chain_teams_resolved: 0,
        tails_parsed: 0,
        chain_wage_sum: 0,
        chain_start_date_sum: 0,
        chain_end_date_sum: 0,
        chain_squad_status_sum: 0,
        chain_event_count_sum: 0,
        current_from_chain: 0,
        current_with_terms: 0,
        current_wage_sum: 0,
        current_end_date_sum: 0,
        current_squad_status_sum: 0,
        current_club_uid_sum: 0,
        current_team_id_sum: 0,
    };

    for (index, player) in players.iter().enumerate() {
        let window_end = players
            .get(index + 1)
            .map(|next| next.record_offset)
            .unwrap_or(game_db.len());

        let records = find_chain_records(
            game_db,
            player.record_offset,
            window_end,
            index + 1 == players.len(),
            player.pindex,
            clubs,
            &mut stats,
        );

        if records.is_empty() {
            continue;
        }
        stats.players_with_chain += 1;

        let player_club_uid = if player.team_id == MISSING_REFERENCE {
            None
        } else {
            clubs.resolve_team(player.team_id).map(|resolution| resolution.club_uid)
        };

        if let Some(current) = in_effect_record(&records, player_club_uid, clock) {
            stats.current_from_chain += 1;
            if current.has_terms {
                stats.current_with_terms += 1;
            }
            stats.current_wage_sum += current.wage as u64;
            stats.current_team_id_sum += current.team_id as u64;
            if let Some(uid) = current.club_uid {
                stats.current_club_uid_sum += uid as u64;
            }
            if let Some(end) = current.end {
                stats.current_end_date_sum += end.ordinal_key();
            }
            if let Some(status) = current.squad_status_raw {
                stats.current_squad_status_sum += status as u64;
            }
        }
    }

    stats
}

fn find_chain_records(
    game_db: &[u8],
    record_offset: usize,
    record_window_end: usize,
    is_last: bool,
    pindex: u32,
    clubs: &ClubIndex,
    stats: &mut ContractStats,
) -> Vec<ChainRecord> {
    let search_start = add_signed(record_offset, CHAIN_WINDOW_START).unwrap_or(0);
    let search_end = if is_last {
        record_window_end
    } else {
        add_signed(record_window_end, CHAIN_WINDOW_END).unwrap_or(search_start)
    }
    .max(search_start)
    .min(game_db.len());

    let selector = pindex.saturating_add(1).to_le_bytes();
    let selector_search_start = search_start.saturating_add(SELECTOR_OFFSET);
    let selector_search_end = search_end
        .saturating_add(SELECTOR_OFFSET)
        .min(game_db.len());

    if selector_search_start >= selector_search_end {
        return Vec::new();
    }

    let mut result = Vec::new();
    for relative in memmem::find_iter(
        &game_db[selector_search_start..selector_search_end],
        &selector,
    ) {
        let hit = selector_search_start + relative;
        let Some(tag_offset) = hit.checked_sub(SELECTOR_OFFSET) else {
            continue;
        };
        if !(search_start..search_end).contains(&tag_offset) {
            continue;
        }

        let tagged = game_db
            .get(tag_offset..tag_offset + TAG.len())
            .is_some_and(|bytes| bytes == TAG);
        let date_marked = !tagged && is_date_marked_record(game_db, tag_offset, clubs);

        if tagged || date_marked {
            if let Some(record) = decode_chain_record(game_db, tag_offset, clubs, stats) {
                result.push(record);
            }
        }
    }
    result
}

fn is_date_marked_record(game_db: &[u8], tag_offset: usize, clubs: &ClubIndex) -> bool {
    if decode_date_at(game_db, tag_offset).is_none() {
        return false;
    }
    let Some(start_at) = add_signed(tag_offset, START_OFFSET) else {
        return false;
    };
    if decode_date_at(game_db, start_at).is_none() {
        return false;
    }
    let Some(team_id) = read_u32(game_db, tag_offset + TEAM_ID_OFFSET) else {
        return false;
    };
    clubs.resolve_team(team_id).is_some()
}

fn decode_chain_record(
    game_db: &[u8],
    tag_offset: usize,
    clubs: &ClubIndex,
    stats: &mut ContractStats,
) -> Option<ChainRecord> {
    let team_id = read_u32(game_db, tag_offset + TEAM_ID_OFFSET)?;
    let wage = read_u32(game_db, tag_offset + WAGE_OFFSET)?;
    let club_uid = clubs.resolve_team(team_id).map(|resolution| resolution.club_uid);

    stats.chain_records += 1;
    stats.chain_wage_sum += wage as u64;
    if club_uid.is_some() {
        stats.chain_teams_resolved += 1;
    }

    let start = add_signed(tag_offset, START_OFFSET)
        .and_then(|offset| decode_date_at(game_db, offset));
    if let Some(value) = start {
        stats.chain_start_date_sum += value.ordinal_key();
    }

    let tail = locate_tail(game_db, tag_offset);
    let (end, squad_status_raw, event_count, has_terms) = if let Some(tail_offset) = tail {
        let end = decode_date_at(game_db, tail_offset + TAIL_END_OFFSET);
        let status = game_db.get(tail_offset + TAIL_SQUAD_STATUS_OFFSET).copied();
        let event_count = read_u32(game_db, tail_offset + TAIL_EVENT_COUNT_OFFSET);
        stats.tails_parsed += 1;
        if let Some(value) = end {
            stats.chain_end_date_sum += value.ordinal_key();
        }
        if let Some(value) = status {
            stats.chain_squad_status_sum += value as u64;
        }
        if let Some(value) = event_count {
            stats.chain_event_count_sum += value as u64;
        }
        (end, status, event_count, true)
    } else {
        (None, None, None, false)
    };

    Some(ChainRecord {
        tag_offset,
        club_uid,
        team_id,
        wage,
        start,
        end,
        has_terms,
        squad_status_raw,
        event_count,
    })
}

fn locate_tail(game_db: &[u8], tag_offset: usize) -> Option<usize> {
    let first = tag_offset.checked_sub(TAIL_BASE_OFFSET)?;
    if tail_matches(game_db, first, 0) {
        return Some(first);
    }

    for event_count in 1..=TAIL_MAX_EVENT_COUNT {
        let distance = TAIL_STEP_BYTES.checked_mul(event_count)?;
        let Some(candidate) = first.checked_sub(distance) else {
            break;
        };
        if tail_matches(game_db, candidate, event_count as u32) {
            return Some(candidate);
        }
    }
    None
}

fn tail_matches(game_db: &[u8], candidate: usize, event_count: u32) -> bool {
    if candidate + TAIL_STRUCT_END > game_db.len() {
        return false;
    }
    if game_db[candidate] != 0 || game_db[candidate + 1] != 0 {
        return false;
    }
    if !game_db[candidate + TAIL_SIGNATURE_OFFSET..]
        .starts_with(TAIL_SIGNATURE)
    {
        return false;
    }
    read_u32(game_db, candidate + TAIL_EVENT_COUNT_OFFSET) == Some(event_count)
}

fn in_effect_record(
    records: &[ChainRecord],
    player_club_uid: Option<u32>,
    clock: GameDate,
) -> Option<&ChainRecord> {
    latest_started(records, player_club_uid, clock, true)
        .or_else(|| latest_started(records, player_club_uid, clock, false))
}

fn latest_started(
    records: &[ChainRecord],
    player_club_uid: Option<u32>,
    clock: GameDate,
    with_tail: bool,
) -> Option<&ChainRecord> {
    let eligible: Vec<&ChainRecord> = records
        .iter()
        .filter(|record| record.has_terms == with_tail)
        .filter(|record| record.start.is_some_and(|start| start <= clock))
        .collect();

    if eligible.is_empty() {
        return None;
    }

    if let Some(player_club_uid) = player_club_uid {
        if let Some(own) = eligible
            .iter()
            .copied()
            .filter(|record| record.club_uid == Some(player_club_uid))
            .filter(|record| record.end.is_none_or(|end| end >= clock))
            .max_by_key(|record| date_key(record))
        {
            return Some(own);
        }

        let running: Vec<&ChainRecord> = eligible
            .iter()
            .copied()
            .filter(|record| record.end.is_none_or(|end| end >= clock))
            .collect();

        if !running.is_empty() {
            let earliest = running
                .iter()
                .copied()
                .min_by_key(|record| (record.start, record.end))?;
            let club_uid = earliest.club_uid;
            return running
                .into_iter()
                .filter(|record| record.club_uid == club_uid)
                .max_by_key(|record| date_key(record));
        }
    }

    eligible.into_iter().max_by_key(|record| date_key(record))
}

fn date_key(record: &ChainRecord) -> (Option<GameDate>, Option<GameDate>, usize) {
    (record.start, record.end.or(record.start), usize::MAX - record.tag_offset)
}

fn add_signed(base: usize, offset: isize) -> Option<usize> {
    if offset >= 0 {
        base.checked_add(offset as usize)
    } else {
        base.checked_sub(offset.unsigned_abs())
    }
}

fn read_u32(buffer: &[u8], offset: usize) -> Option<u32> {
    let bytes: [u8; 4] = buffer.get(offset..offset + 4)?.try_into().ok()?;
    Some(u32::from_le_bytes(bytes))
}
