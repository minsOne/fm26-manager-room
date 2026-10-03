use crate::player_scan::PlayerCandidate;
use anyhow::{anyhow, Result};
use memchr::memmem;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

const ANCHOR: &[u8] = &[0xff, 0xff, 0xff, 0xff];
const ANCHOR_OFFSET: usize = 17;
const STOP_GAP_BYTES: usize = 64 * 1024;
const ZERO_BYTE_OFFSET: usize = 12;
const NATION_OFFSET: usize = 13;
const FA_NATION_OFFSET: usize = 21;
const NATION_COPY_OFFSET: usize = 25;
const CITY_OFFSET: usize = 29;
const LONG_NAME_OFFSET: usize = 39;
const CLUB_INDEX_OFFSET: usize = 0;
const UID_OFFSET: usize = 4;
const UID_COPY_OFFSET: usize = 8;
const NATION_MIN: u32 = 1;
const NATION_MAX: u32 = 999;
const MAX_NAME_BYTES: usize = 64;
const MISSING_REFERENCE: u32 = u32::MAX;

const STATUS_ORDINAL_OFFSET: isize = -4;
const STATUS_ORDINAL_LIMIT: u32 = 200_000;
const STATUS_KIND_OFFSET: usize = 8;
const STATUS_NORMAL_KIND: u8 = 0x0A;
const STATUS_STUB_KIND: u8 = 0x0B;
const STATUS_POSITION_OFFSET: usize = 10;
const STATUS_REPUTATION_OFFSET: usize = 11;
const STATUS_REPUTATION_MIN: u16 = 1;
const STATUS_REPUTATION_MAX: u16 = 10_000;
const STATUS_SEARCH_WINDOW_BYTES: usize = 256 * 1024;
const STATUS_MAXIMUM_LEADING_MISSES: usize = 16;

const NULL_DATE_TRIPLE: &[u8] = &[
    0x01, 0x00, 0x6c, 0x07,
    0x01, 0x00, 0x6c, 0x07,
    0x01, 0x00, 0x6c, 0x07,
];
const FLOAT_ANCHOR: &[u8] = &[0x00, 0x00, 0x80, 0x3f];
const FLOAT_ANCHOR_OFFSET: usize = 33;
const MINIMUM_FLOAT_RECORD_OFFSET: usize = 40;
const COUNTS_OFFSET: usize = 37;
const FIRST_ENTRY_BYTES: usize = 25;
const FIRST_ENTRY_LEAD: u8 = 0x02;
const SECOND_ENTRY_BYTES: usize = 12;
const SECOND_ENTRY_LEAD: u8 = 0x01;
const FILLER_BYTES: usize = 9;
const TEAM_COUNT_MIN: u8 = 1;
const TEAM_COUNT_MAX: u8 = 8;
const TEAM_ID_MIN: u32 = 1;
const TEAM_ID_MAX: u32 = 3_000_000;
const AFFILIATE_COUNT_MAX: u8 = 8;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClubCore {
    pub record_start: usize,
    pub record_end: usize,
    pub club_index: u32,
    pub uid: u32,
    pub nation_id: u32,
    pub fa_nation_id: u32,
    pub city_id: Option<u32>,
    pub name: String,
    pub short_name: String,
    pub reputation: Option<u16>,
    pub last_league_position: Option<u8>,
    pub team_ids: Vec<u32>,
    pub affiliate_team_ids: Vec<u32>,
}

#[derive(Debug, Clone, Copy)]
pub struct TeamResolution {
    pub club_uid: u32,
    pub team_slot: usize,
    pub registration_club_uid: Option<u32>,
}

#[derive(Debug)]
pub struct ClubIndex {
    pub clubs: Vec<ClubCore>,
    club_by_uid: HashMap<u32, usize>,
    team_to_club: HashMap<u32, (u32, usize)>,
    affiliate_team_to_club: HashMap<u32, (u32, usize)>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClubScanStats {
    pub clubs: usize,
    pub teams: usize,
    pub affiliate_teams: usize,
    pub uid_sum: u64,
    pub nation_sum: u64,
    pub name_hash_fnv1a64: u64,
    pub reputation_found: usize,
    pub reputation_sum: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerClubJoinStats {
    pub with_team: usize,
    pub team_resolved: usize,
    pub team_id_sum: u64,
    pub club_uid_sum: u64,
    pub club_nation_sum: u64,
    pub club_name_hash_fnv1a64: u64,
    pub affiliate_registration_count: usize,
}

#[derive(Debug)]
struct RawClub {
    record_start: usize,
    club_index: u32,
    uid: u32,
    nation_id: u32,
    fa_nation_id: u32,
    city_id: Option<u32>,
    name: String,
    short_name: String,
}

#[derive(Debug, Default)]
struct TeamList {
    team_ids: Vec<u32>,
    affiliate_team_ids: Vec<u32>,
}

impl ClubIndex {
    pub fn scan(game_db: &[u8]) -> Result<(Self, ClubScanStats)> {
        let (records, scan_end) = scan_records(game_db)?;
        let mut team_lists = Vec::with_capacity(records.len());

        for (index, record) in records.iter().enumerate() {
            let record_end = records
                .get(index + 1)
                .map(|next| next.record_start)
                .unwrap_or(scan_end);
            team_lists.push(read_team_list(game_db, record.record_start, record_end)?);
        }

        let mut team_to_club = HashMap::new();
        for (record, teams) in records.iter().zip(&team_lists) {
            for (slot, team_id) in teams.team_ids.iter().copied().enumerate() {
                team_to_club.entry(team_id).or_insert((record.uid, slot));
            }
        }

        let mut affiliate_team_to_club = HashMap::new();
        let mut claimed_affiliates = HashSet::new();

        for (record, teams) in records.iter().zip(&team_lists) {
            let mut accepted = 0usize;
            for team_id in &teams.affiliate_team_ids {
                let Some((storing_club_uid, _)) = team_to_club.get(team_id).copied() else {
                    continue;
                };
                if storing_club_uid == record.uid || claimed_affiliates.contains(team_id) {
                    continue;
                }
                let slot = teams.team_ids.len() + accepted;
                affiliate_team_to_club.insert(*team_id, (record.uid, slot));
                claimed_affiliates.insert(*team_id);
                accepted += 1;
            }
        }

        let record_ends: Vec<usize> = records
            .iter()
            .skip(1)
            .map(|record| record.record_start)
            .chain(std::iter::once(scan_end))
            .collect();

        let statuses = read_statuses(game_db, &records);

        let clubs: Vec<ClubCore> = records
            .into_iter()
            .zip(team_lists)
            .zip(record_ends)
            .map(|((record, teams), record_end)| {
                let status = statuses.get(&record.uid).copied().unwrap_or_default();
                ClubCore {
                record_start: record.record_start,
                record_end,
                club_index: record.club_index,
                uid: record.uid,
                nation_id: record.nation_id,
                fa_nation_id: record.fa_nation_id,
                city_id: record.city_id,
                name: record.name,
                short_name: record.short_name,
                reputation: status.reputation,
                last_league_position: status.last_league_position,
                team_ids: teams.team_ids,
                affiliate_team_ids: teams.affiliate_team_ids,
            }
            })
            .collect();

        let club_by_uid = clubs
            .iter()
            .enumerate()
            .map(|(index, club)| (club.uid, index))
            .collect::<HashMap<_, _>>();

        let mut name_hash = FNV_OFFSET_BASIS;
        let mut order: Vec<&ClubCore> = clubs.iter().collect();
        order.sort_by_key(|club| club.club_index);
        for club in order {
            name_hash = fnv_update(name_hash, &club.uid.to_le_bytes());
            name_hash = fnv_update(name_hash, club.name.as_bytes());
            name_hash = fnv_update(name_hash, &[0xff]);
        }

        let stats = ClubScanStats {
            clubs: clubs.len(),
            teams: team_to_club.len(),
            affiliate_teams: affiliate_team_to_club.len(),
            uid_sum: clubs.iter().map(|club| club.uid as u64).sum(),
            nation_sum: clubs.iter().map(|club| club.nation_id as u64).sum(),
            name_hash_fnv1a64: name_hash,
            reputation_found: clubs.iter().filter(|club| club.reputation.is_some()).count(),
            reputation_sum: clubs.iter().filter_map(|club| club.reputation).map(u64::from).sum(),
        };

        Ok((
            Self {
                clubs,
                club_by_uid,
                team_to_club,
                affiliate_team_to_club,
            },
            stats,
        ))
    }

    pub fn resolve_team(&self, team_id: u32) -> Option<TeamResolution> {
        let (storing_club_uid, stored_slot) = self.team_to_club.get(&team_id).copied()?;
        if let Some((fielding_club_uid, fielding_slot)) =
            self.affiliate_team_to_club.get(&team_id).copied()
        {
            Some(TeamResolution {
                club_uid: fielding_club_uid,
                team_slot: fielding_slot,
                registration_club_uid: Some(storing_club_uid),
            })
        } else {
            Some(TeamResolution {
                club_uid: storing_club_uid,
                team_slot: stored_slot,
                registration_club_uid: None,
            })
        }
    }

    pub fn club(&self, uid: u32) -> Option<&ClubCore> {
        self.club_by_uid.get(&uid).and_then(|index| self.clubs.get(*index))
    }

    pub fn player_join_stats(&self, players: &[PlayerCandidate]) -> PlayerClubJoinStats {
        let mut with_team = 0usize;
        let mut team_resolved = 0usize;
        let mut team_id_sum = 0u64;
        let mut club_uid_sum = 0u64;
        let mut club_nation_sum = 0u64;
        let mut club_name_hash = FNV_OFFSET_BASIS;
        let mut affiliate_registration_count = 0usize;

        for player in players {
            if player.team_id == MISSING_REFERENCE {
                continue;
            }
            with_team += 1;
            team_id_sum += player.team_id as u64;

            let Some(resolution) = self.resolve_team(player.team_id) else {
                continue;
            };
            let Some(club) = self.club(resolution.club_uid) else {
                continue;
            };

            team_resolved += 1;
            club_uid_sum += club.uid as u64;
            club_nation_sum += club.nation_id as u64;
            if resolution.registration_club_uid.is_some() {
                affiliate_registration_count += 1;
            }

            club_name_hash = fnv_update(club_name_hash, &player.uid.to_le_bytes());
            club_name_hash = fnv_update(club_name_hash, &club.uid.to_le_bytes());
            club_name_hash = fnv_update(club_name_hash, club.name.as_bytes());
            club_name_hash = fnv_update(club_name_hash, &[0xff]);
        }

        PlayerClubJoinStats {
            with_team,
            team_resolved,
            team_id_sum,
            club_uid_sum,
            club_nation_sum,
            club_name_hash_fnv1a64: club_name_hash,
            affiliate_registration_count,
        }
    }
}

fn scan_records(game_db: &[u8]) -> Result<(Vec<RawClub>, usize)> {
    let mut records = Vec::new();
    let mut last_accepted_start = 0usize;

    for anchor_hit in memmem::find_iter(game_db, ANCHOR) {
        if anchor_hit < ANCHOR_OFFSET {
            continue;
        }
        let record_start = anchor_hit - ANCHOR_OFFSET;

        if !records.is_empty()
            && record_start.saturating_sub(last_accepted_start) >= STOP_GAP_BYTES
        {
            break;
        }

        if record_start + LONG_NAME_OFFSET + 4 > game_db.len()
            || game_db.get(record_start + ZERO_BYTE_OFFSET).copied() != Some(0)
        {
            continue;
        }

        if let Some(record) = accept_record(game_db, record_start)? {
            last_accepted_start = record_start;
            records.push(record);
        }
    }

    if records.is_empty() {
        return Err(anyhow!("no FM26 club records found"));
    }

    let scan_end = usize::min(
        last_accepted_start.saturating_add(STOP_GAP_BYTES),
        game_db.len(),
    );
    Ok((records, scan_end))
}

fn accept_record(game_db: &[u8], record_start: usize) -> Result<Option<RawClub>> {
    let nation_id = read_u32(game_db, record_start + NATION_OFFSET)?;
    if !(NATION_MIN..=NATION_MAX).contains(&nation_id) {
        return Ok(None);
    }
    if read_u32(game_db, record_start + NATION_COPY_OFFSET)? != nation_id {
        return Ok(None);
    }

    let fa_nation_id = read_u32(game_db, record_start + FA_NATION_OFFSET)?;
    if !(NATION_MIN..=NATION_MAX).contains(&fa_nation_id) {
        return Ok(None);
    }

    let stored_uid = read_u32(game_db, record_start + UID_OFFSET)?;
    if read_u32(game_db, record_start + UID_COPY_OFFSET)? != stored_uid {
        return Ok(None);
    }

    let long_name_length_at = record_start + LONG_NAME_OFFSET;
    let long_name_length = read_u32(game_db, long_name_length_at)? as usize;
    if !(1..=MAX_NAME_BYTES).contains(&long_name_length) {
        return Ok(None);
    }

    let long_name_start = long_name_length_at + 4;
    let short_name_length_at = long_name_start + long_name_length;
    let short_name_length = read_u32(game_db, short_name_length_at)? as usize;
    if !(1..=MAX_NAME_BYTES).contains(&short_name_length) {
        return Ok(None);
    }
    let short_name_start = short_name_length_at + 4;
    let short_name_end = short_name_start + short_name_length;

    let name = match game_db.get(long_name_start..short_name_length_at) {
        Some(bytes) => match std::str::from_utf8(bytes) {
            Ok(value) => value.to_owned(),
            Err(_) => return Ok(None),
        },
        None => return Ok(None),
    };
    let short_name = match game_db.get(short_name_start..short_name_end) {
        Some(bytes) => match std::str::from_utf8(bytes) {
            Ok(value) => value.to_owned(),
            Err(_) => return Ok(None),
        },
        None => return Ok(None),
    };

    let stored_index = read_u32(game_db, record_start + CLUB_INDEX_OFFSET)?;
    let stored_city = read_u32(game_db, record_start + CITY_OFFSET)?;

    Ok(Some(RawClub {
        record_start,
        club_index: stored_index.saturating_add(1),
        uid: stored_uid.saturating_add(1),
        nation_id,
        fa_nation_id,
        city_id: if stored_city == MISSING_REFERENCE {
            None
        } else {
            Some(stored_city)
        },
        name,
        short_name,
    }))
}

fn read_team_list(game_db: &[u8], record_start: usize, record_end: usize) -> Result<TeamList> {
    if let Some(relative) = memmem::find(&game_db[record_start..record_end], NULL_DATE_TRIPLE) {
        let start = record_start + relative;
        if let Some(list) = parse_team_list(game_db, start, record_end)? {
            return Ok(list);
        }
    }

    let float_search_start = usize::min(
        record_start.saturating_add(MINIMUM_FLOAT_RECORD_OFFSET),
        record_end,
    );

    for relative in memmem::find_iter(&game_db[float_search_start..record_end], FLOAT_ANCHOR) {
        let hit = float_search_start + relative;
        let Some(start) = hit.checked_sub(FLOAT_ANCHOR_OFFSET) else {
            continue;
        };
        if start < record_start {
            continue;
        }
        if let Some(list) = parse_team_list(game_db, start, record_end)? {
            return Ok(list);
        }
    }

    Ok(TeamList::default())
}

fn parse_team_list(
    game_db: &[u8],
    team_list_start: usize,
    record_end: usize,
) -> Result<Option<TeamList>> {
    let mut cursor = team_list_start + COUNTS_OFFSET;

    for (entry_bytes, lead_byte) in [
        (FIRST_ENTRY_BYTES, FIRST_ENTRY_LEAD),
        (SECOND_ENTRY_BYTES, SECOND_ENTRY_LEAD),
    ] {
        if cursor >= record_end {
            return Ok(None);
        }
        let count = game_db[cursor] as usize;
        let entries_start = cursor + 1;
        let entries_end = match entries_start.checked_add(count.saturating_mul(entry_bytes)) {
            Some(value) if value <= record_end => value,
            _ => return Ok(None),
        };
        for entry_start in (entries_start..entries_end).step_by(entry_bytes) {
            if game_db.get(entry_start).copied() != Some(lead_byte) {
                return Ok(None);
            }
        }
        cursor = entries_end;
    }

    let team_count_at = cursor + FILLER_BYTES;
    if team_count_at >= record_end {
        return Ok(None);
    }
    let team_count = game_db[team_count_at];
    if !(TEAM_COUNT_MIN..=TEAM_COUNT_MAX).contains(&team_count) {
        return Ok(None);
    }

    let team_ids_start = team_count_at + 1;
    let team_ids_end = team_ids_start + team_count as usize * 4;
    if team_ids_end > record_end {
        return Ok(None);
    }

    let mut team_ids = Vec::with_capacity(team_count as usize);
    for offset in (team_ids_start..team_ids_end).step_by(4) {
        let team_id = read_u32(game_db, offset)?;
        if !(TEAM_ID_MIN..=TEAM_ID_MAX).contains(&team_id) {
            return Ok(None);
        }
        team_ids.push(team_id);
    }

    let affiliate_count_at = team_ids_end;
    let mut affiliate_team_ids = Vec::new();
    if affiliate_count_at < record_end {
        let count = game_db[affiliate_count_at];
        if count <= AFFILIATE_COUNT_MAX && count > 0 {
            let start = affiliate_count_at + 1;
            let end = start + count as usize * 4;
            if end <= record_end {
                let mut valid = true;
                for offset in (start..end).step_by(4) {
                    let team_id = read_u32(game_db, offset)?;
                    if !(TEAM_ID_MIN..=TEAM_ID_MAX).contains(&team_id) {
                        valid = false;
                        break;
                    }
                    affiliate_team_ids.push(team_id);
                }
                if !valid {
                    affiliate_team_ids.clear();
                }
            }
        }
    }

    Ok(Some(TeamList {
        team_ids,
        affiliate_team_ids,
    }))
}


#[derive(Debug, Clone, Copy, Default)]
struct ClubStatus {
    reputation: Option<u16>,
    last_league_position: Option<u8>,
}

fn read_statuses(game_db: &[u8], records: &[RawClub]) -> HashMap<u32, ClubStatus> {
    let mut order = records.iter().collect::<Vec<_>>();
    order.sort_by_key(|record| record.club_index);

    let mut result = HashMap::new();
    let mut cursor = 0usize;
    let mut previous_ordinal: Option<u32> = None;
    let mut found_first = false;
    let mut leading_misses = 0usize;

    for record in order {
        let stored_uid = record.uid.saturating_sub(1);
        let mut needle = [0u8; 8];
        needle[..4].copy_from_slice(&stored_uid.to_le_bytes());
        needle[4..].copy_from_slice(&stored_uid.to_le_bytes());

        let search_end = if found_first {
            game_db.len().min(cursor.saturating_add(STATUS_SEARCH_WINDOW_BYTES + needle.len()))
        } else {
            game_db.len()
        };

        let mut status = ClubStatus::default();
        let mut accepted = false;
        let mut search_at = cursor;

        while search_at < search_end {
            let Some(relative) = memmem::find(&game_db[search_at..search_end], &needle) else {
                break;
            };
            let hit = search_at + relative;
            let Some(ordinal_at) = add_signed(hit, STATUS_ORDINAL_OFFSET) else {
                search_at = hit + 1;
                continue;
            };
            let kind_at = hit.saturating_add(STATUS_KIND_OFFSET);
            let Some(ordinal) = read_u32_at(game_db, ordinal_at) else {
                search_at = hit + 1;
                continue;
            };
            let Some(kind) = game_db.get(kind_at).copied() else {
                break;
            };

            let ordinal_ok = ordinal < STATUS_ORDINAL_LIMIT
                && previous_ordinal.is_none_or(|previous| ordinal > previous);
            if ordinal_ok && (kind == STATUS_NORMAL_KIND || kind == STATUS_STUB_KIND) {
                accepted = true;
                previous_ordinal = Some(ordinal);
                cursor = kind_at;
                if kind == STATUS_NORMAL_KIND {
                    let last_league_position = game_db
                        .get(hit + STATUS_POSITION_OFFSET)
                        .copied();
                    let reputation = read_u16_at(game_db, hit + STATUS_REPUTATION_OFFSET)
                        .filter(|value| (STATUS_REPUTATION_MIN..=STATUS_REPUTATION_MAX).contains(value));
                    status = ClubStatus { reputation, last_league_position };
                }
                break;
            }
            search_at = hit + 1;
        }

        result.insert(record.uid, status);
        if accepted {
            found_first = true;
        } else if !found_first {
            leading_misses += 1;
            if leading_misses >= STATUS_MAXIMUM_LEADING_MISSES {
                break;
            }
        }
    }
    result
}

fn add_signed(value: usize, offset: isize) -> Option<usize> {
    if offset >= 0 {
        value.checked_add(offset as usize)
    } else {
        value.checked_sub(offset.unsigned_abs())
    }
}

fn read_u16_at(buffer: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(buffer.get(offset..offset + 2)?.try_into().ok()?))
}

fn read_u32_at(buffer: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(buffer.get(offset..offset + 4)?.try_into().ok()?))
}

fn read_u32(buffer: &[u8], offset: usize) -> Result<u32> {
    let bytes: [u8; 4] = buffer
        .get(offset..offset + 4)
        .ok_or_else(|| anyhow!("u32 read outside game_db at {offset}"))?
        .try_into()
        .expect("four bytes");
    Ok(u32::from_le_bytes(bytes))
}

const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

fn fnv_update(mut hash: u64, bytes: &[u8]) -> u64 {
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}
