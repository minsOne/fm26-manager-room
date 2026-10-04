use crate::metadata::{decode_date_at, GameDate};
use crate::player_scan::PlayerCandidate;
use memchr::memchr;
use serde::Serialize;

const OWNER_BACK_OFFSET: usize = 30;
const LIST_HEADER_BYTES: usize = 10;
const HEADER_BYTES: usize = 15;
const RECORD_BYTES: usize = 54;
const LEAD: u8 = 0x01;
const DATE_OFFSET: usize = 1;
const OPPONENT_TEAM_OFFSET: usize = 5;
const COMPETITION_OFFSET: usize = 9;
const BODY_FLAG_OFFSET: usize = 14;
const MINUTES_OFFSET: usize = 39;
const LOWEST_TEAM_ID: u32 = 1;
const HIGHEST_TEAM_ID: u32 = 2_999_999;
const HIGHEST_COMPETITION_ID: u32 = 65_535;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentMinutes {
    pub last14: u16,
    pub last5: u16,
    pub known: bool,
    pub retained_matches: u16,
    #[serde(skip)]
    pub records: Vec<MatchRow>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchHistoryStats {
    pub players_with_history: usize,
    pub retained_records: usize,
    pub records_with_stats: usize,
    pub last14_sum: u64,
    pub last5_sum: u64,
}

#[derive(Debug, Clone, Copy)]
pub struct MatchRow {
    pub date: GameDate,
    pub opponent_team_id: u32,
    pub competition_id: u32,
    pub has_stats: bool,
    pub minutes: u8,
}

pub fn recent_minutes_all(
    game_db: &[u8],
    players: &[PlayerCandidate],
    clock: GameDate,
) -> (Vec<RecentMinutes>, MatchHistoryStats) {
    let mut output = Vec::with_capacity(players.len());
    let mut stats = MatchHistoryStats::default();

    for (index, player) in players.iter().enumerate() {
        let owned_start = player.record_offset.saturating_sub(OWNER_BACK_OFFSET);
        let owned_end = players
            .get(index + 1)
            .map(|next| next.record_offset.saturating_sub(OWNER_BACK_OFFSET))
            .unwrap_or(game_db.len())
            .min(game_db.len());

        let mut rows = locate_player_history(game_db, owned_start, owned_end, clock);
        if !rows.is_empty() {
            stats.players_with_history += 1;
        }
        stats.retained_records += rows.len();
        stats.records_with_stats += rows.iter().filter(|row| row.has_stats).count();

        rows.retain(|row| row.date <= clock);
        rows.sort_by(|a, b| b.date.cmp(&a.date));

        let cutoff = day_number(clock).saturating_sub(14);
        let last14: u32 = rows
            .iter()
            .filter(|row| row.has_stats && day_number(row.date) >= cutoff)
            .map(|row| row.minutes as u32)
            .sum();
        let last5: u32 = rows
            .iter()
            .filter(|row| row.has_stats)
            .take(5)
            .map(|row| row.minutes as u32)
            .sum();

        stats.last14_sum += last14 as u64;
        stats.last5_sum += last5 as u64;
        output.push(RecentMinutes {
            last14: last14.min(u16::MAX as u32) as u16,
            last5: last5.min(u16::MAX as u32) as u16,
            known: !rows.is_empty(),
            retained_matches: rows.len().min(u16::MAX as usize) as u16,
            records: rows,
        });
    }
    (output, stats)
}

fn locate_player_history(
    game_db: &[u8],
    start: usize,
    end: usize,
    clock: GameDate,
) -> Vec<MatchRow> {
    if start >= end || end > game_db.len() {
        return Vec::new();
    }
    let mut position = start;
    let mut output = Vec::new();

    while position + 2 + LIST_HEADER_BYTES + HEADER_BYTES <= end {
        let Some(relative) = memchr(0x01, &game_db[position..end]) else { break; };
        let parent = position + relative;
        position = parent + 1;

        if parent + 2 > end { break; }
        let child_count = game_db[parent + 1] as usize;
        if child_count == 0 { continue; }

        let mut list_at = parent + 2;
        if !valid_list_header(game_db, list_at, end) { continue; }
        if !valid_first_record(game_db, list_at + LIST_HEADER_BYTES, end) { continue; }

        let mut parent_rows = Vec::new();
        let mut complete = true;
        for _ in 0..child_count {
            if !valid_list_header(game_db, list_at, end) { complete = false; break; }
            let count = read_u32(game_db, list_at + 6).unwrap_or(0) as usize;
            if count == 0 { complete = false; break; }
            let mut at = list_at + LIST_HEADER_BYTES;
            for _ in 0..count {
                let Some((row, size)) = read_record(game_db, at, end) else {
                    complete = false; break;
                };
                let opponent = read_u32(game_db, at + OPPONENT_TEAM_OFFSET).unwrap_or(0);
                let competition = read_u32(game_db, at + COMPETITION_OFFSET).unwrap_or(0);
                if row.date.year + 4 >= clock.year
                    && row.date.year <= clock.year + 1
                    && (LOWEST_TEAM_ID..=HIGHEST_TEAM_ID).contains(&opponent)
                    && (1..=HIGHEST_COMPETITION_ID).contains(&competition)
                {
                    parent_rows.push(row);
                }
                at += size;
            }
            if !complete { break; }
            list_at = at;
        }

        if complete {
            if valid_list_header(game_db, list_at, end) {
                let extra_count = read_u32(game_db, list_at + 6).unwrap_or(0) as usize;
                if extra_count > 0 && complete_child(game_db, list_at, extra_count, end) {
                    continue;
                }
            }
            output.extend(parent_rows);
            position = list_at;
        }
    }
    output
}

fn complete_child(game_db: &[u8], list_at: usize, count: usize, end: usize) -> bool {
    if !valid_list_header(game_db, list_at, end) { return false; }
    let mut at = list_at + LIST_HEADER_BYTES;
    for _ in 0..count {
        let Some((_row, size)) = read_record(game_db, at, end) else { return false; };
        at += size;
    }
    true
}

fn valid_list_header(game_db: &[u8], at: usize, end: usize) -> bool {
    if at + LIST_HEADER_BYTES > end { return false; }
    matches!(game_db.get(at..at + 2), Some([0x14,0x01]) | Some([0x3c,0x01]))
}

fn valid_first_record(game_db: &[u8], at: usize, end: usize) -> bool {
    if at + HEADER_BYTES > end || game_db.get(at).copied() != Some(LEAD) { return false; }
    if decode_date_at(game_db, at + DATE_OFFSET).is_none() { return false; }
    let opponent = read_u32(game_db, at + OPPONENT_TEAM_OFFSET).unwrap_or(0);
    let competition = read_u32(game_db, at + COMPETITION_OFFSET).unwrap_or(u32::MAX);
    (LOWEST_TEAM_ID..=HIGHEST_TEAM_ID).contains(&opponent)
        && (competition == u32::MAX || competition <= HIGHEST_COMPETITION_ID)
}

fn read_record(game_db: &[u8], at: usize, end: usize) -> Option<(MatchRow, usize)> {
    if at + HEADER_BYTES > end || game_db.get(at).copied()? != LEAD { return None; }
    let date = decode_date_at(game_db, at + DATE_OFFSET)?;
    let flag = *game_db.get(at + BODY_FLAG_OFFSET)?;
    if flag > 1 { return None; }
    let size = if flag == 1 { RECORD_BYTES } else { HEADER_BYTES };
    if at + size > end { return None; }
    Some((MatchRow {
        date,
        opponent_team_id: read_u32(game_db, at + OPPONENT_TEAM_OFFSET)?,
        competition_id: read_u32(game_db, at + COMPETITION_OFFSET)?,
        has_stats: flag == 1,
        minutes: if flag == 1 { *game_db.get(at + MINUTES_OFFSET)? } else { 0 },
    }, size))
}

fn day_number(date: GameDate) -> i64 {
    let y = date.year as i64 - 1;
    y * 365 + y / 4 - y / 100 + y / 400 + date.day_of_year as i64
}
fn read_u32(buffer: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(buffer.get(offset..offset + 4)?.try_into().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn raw_record(day: u16, stats: bool, minutes: u8) -> Vec<u8> {
        let mut bytes = vec![0; if stats { RECORD_BYTES } else { HEADER_BYTES }];
        bytes[0] = LEAD;
        bytes[1..3].copy_from_slice(&day.to_le_bytes());
        bytes[3..5].copy_from_slice(&2036u16.to_le_bytes());
        bytes[5..9].copy_from_slice(&77u32.to_le_bytes());
        bytes[9..13].copy_from_slice(&12u32.to_le_bytes());
        bytes[14] = u8::from(stats);
        if stats { bytes[MINUTES_OFFSET] = minutes; }
        bytes
    }
    #[test]
    fn dated_headers_preserve_identity_and_missing_stats() {
        let raw = raw_record(60, false, 0);
        let (row, size) = read_record(&raw, 0, raw.len()).unwrap();
        assert_eq!(size, HEADER_BYTES);
        assert_eq!(row.date, GameDate { year: 2036, day_of_year: 60 });
        assert_eq!(row.opponent_team_id, 77);
        assert_eq!(row.competition_id, 12);
        assert!(!row.has_stats);
        assert_eq!(row.has_stats.then_some(row.minutes), None);
        for minutes in [0, 90, 120] {
            let bytes = raw_record(61, true, minutes);
            let (with_stats, _) = read_record(&bytes, 0, bytes.len()).unwrap();
            assert_eq!(with_stats.has_stats.then_some(with_stats.minutes), Some(minutes));
        }
    }
    #[test]
    fn malformed_or_truncated_records_are_rejected() {
        let mut bytes = raw_record(61, true, 90);
        assert!(read_record(&bytes, 0, bytes.len()-1).is_none());
        bytes[14] = 2;
        assert!(read_record(&bytes, 0, bytes.len()).is_none());
    }
    #[test]
    fn retained_history_keeps_headers_and_excludes_future_dates() {
        let mut bytes = vec![0x01, 1, 0x14, 0x01, 0, 0, 0, 0];
        bytes.extend_from_slice(&3u32.to_le_bytes());
        bytes.extend(raw_record(60, true, 90));
        bytes.extend(raw_record(61, false, 0));
        bytes.extend(raw_record(62, true, 40));
        let player = PlayerCandidate { record_offset: 30, pindex: 1, uid: 7, team_id: 1,
            current_ability: 100, potential_ability: 130 };
        let (histories, stats) = recent_minutes_all(&bytes, &[player], GameDate { year: 2036, day_of_year: 61 });
        assert_eq!(stats.retained_records, 3);
        assert_eq!(histories[0].records.len(), 2);
        assert_eq!(histories[0].last14, 90);
        assert!(!histories[0].records[0].has_stats);
    }
}
