use memchr::memmem;
use serde::Serialize;
use std::collections::HashSet;

const MARKER: &[u8] = &[0x01, 0x00, 0x6c, 0x07];
const MARKER_OFFSET: usize = 102;
const RATINGS_OFFSET: usize = 24;
const RATINGS_COUNT: usize = 15;
const ATTRIBUTES_OFFSET: usize = 39;
const ATTRIBUTE_COUNT: usize = 54;
const DECODE_EXTENT: usize = 122;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerCandidate {
    pub record_offset: usize,
    pub pindex: u32,
    pub uid: u32,
    pub current_ability: u16,
    pub potential_ability: i16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerScanStats {
    pub marker_hits: usize,
    pub marker_candidates: usize,
    pub completeness_candidates: usize,
    pub total_candidates: usize,
    pub current_ability_sum: u64,
    pub potential_ability_raw_sum: i64,
    pub sample: Vec<PlayerCandidate>,
}

pub fn scan(game_db: &[u8]) -> PlayerScanStats {
    let mut marker_hits = 0usize;
    let mut marker_candidates = Vec::new();
    let mut offsets = HashSet::new();

    for marker_hit in memmem::find_iter(game_db, MARKER) {
        marker_hits += 1;
        if marker_hit < MARKER_OFFSET {
            continue;
        }
        let record_offset = marker_hit - MARKER_OFFSET;
        if let Some(candidate) = accept_candidate(game_db, record_offset, true) {
            offsets.insert(record_offset);
            marker_candidates.push(candidate);
        }
    }

    let mut completeness_candidates = Vec::new();
    let mut run_start = None;

    for (index, byte) in game_db.iter().copied().enumerate() {
        if (1..=100).contains(&byte) {
            if run_start.is_none() {
                run_start = Some(index);
            }
        } else if let Some(start) = run_start.take() {
            scan_flagged_run(
                game_db,
                start,
                index,
                &offsets,
                &mut completeness_candidates,
            );
        }
    }
    if let Some(start) = run_start {
        scan_flagged_run(
            game_db,
            start,
            game_db.len(),
            &offsets,
            &mut completeness_candidates,
        );
    }

    let mut all = marker_candidates.clone();
    all.extend(completeness_candidates.iter().copied());
    all.sort_by_key(|candidate| candidate.record_offset);
    all.dedup_by_key(|candidate| candidate.record_offset);

    let current_ability_sum = all.iter().map(|candidate| candidate.current_ability as u64).sum();
    let potential_ability_raw_sum = all.iter().map(|candidate| candidate.potential_ability as i64).sum();

    PlayerScanStats {
        marker_hits,
        marker_candidates: marker_candidates.len(),
        completeness_candidates: completeness_candidates.len(),
        total_candidates: all.len(),
        current_ability_sum,
        potential_ability_raw_sum,
        sample: all.into_iter().take(8).collect(),
    }
}

fn scan_flagged_run(
    game_db: &[u8],
    run_start: usize,
    run_end: usize,
    marker_offsets: &HashSet<usize>,
    output: &mut Vec<PlayerCandidate>,
) {
    const PATTERN_LEN: usize = RATINGS_COUNT + ATTRIBUTE_COUNT;
    if run_end.saturating_sub(run_start) < PATTERN_LEN {
        return;
    }

    let last = run_end - PATTERN_LEN;
    for ratings_start in run_start..=last {
        if ratings_start < RATINGS_OFFSET {
            continue;
        }

        // The entire run is already known to be within 1...100, so only the
        // first 15 rating bytes need the tighter 1...20 check.
        if !game_db[ratings_start..ratings_start + RATINGS_COUNT]
            .iter()
            .all(|value| (1..=20).contains(value))
        {
            continue;
        }

        let record_offset = ratings_start - RATINGS_OFFSET;
        if marker_offsets.contains(&record_offset) {
            continue;
        }

        if let Some(candidate) = accept_candidate(game_db, record_offset, false) {
            output.push(candidate);
        }
    }
}

fn accept_candidate(
    game_db: &[u8],
    record_offset: usize,
    check_pattern: bool,
) -> Option<PlayerCandidate> {
    if record_offset.checked_add(DECODE_EXTENT)? > game_db.len() {
        return None;
    }
    if record_offset < 19 {
        return None;
    }

    let pindex = read_u32(game_db, record_offset.checked_sub(19)?)?;
    let uid = read_u32(game_db, record_offset.checked_sub(15)?)?;
    let uid_copy = read_u32(game_db, record_offset.checked_sub(11)?)?;

    if uid == 0 || uid == u32::MAX || uid_copy == 0 || uid_copy == u32::MAX {
        return None;
    }

    if uid != uid_copy {
        let object_kind = *game_db.get(record_offset.checked_sub(7)?)?;
        if uid < 2_000_000_000 || object_kind != 2 {
            return None;
        }
    }

    let current_ability = read_u16(game_db, record_offset)?;
    if current_ability > 200 {
        return None;
    }

    let potential_ability = read_i16(game_db, record_offset + 2)?;
    if !(-10..=200).contains(&potential_ability) {
        return None;
    }

    let reputation_bucket = *game_db.get(record_offset + 8)?;
    if reputation_bucket > 200 {
        return None;
    }

    if check_pattern && !player_pattern_matches(game_db, record_offset) {
        return None;
    }

    Some(PlayerCandidate {
        record_offset,
        pindex,
        uid,
        current_ability,
        potential_ability,
    })
}

fn player_pattern_matches(game_db: &[u8], record_offset: usize) -> bool {
    let ratings_start = record_offset + RATINGS_OFFSET;
    let attrs_start = record_offset + ATTRIBUTES_OFFSET;
    game_db[ratings_start..ratings_start + RATINGS_COUNT]
        .iter()
        .all(|value| (1..=20).contains(value))
        && game_db[attrs_start..attrs_start + ATTRIBUTE_COUNT]
            .iter()
            .all(|value| (1..=100).contains(value))
}

fn read_u16(buffer: &[u8], offset: usize) -> Option<u16> {
    let bytes: [u8; 2] = buffer.get(offset..offset + 2)?.try_into().ok()?;
    Some(u16::from_le_bytes(bytes))
}

fn read_i16(buffer: &[u8], offset: usize) -> Option<i16> {
    let bytes: [u8; 2] = buffer.get(offset..offset + 2)?.try_into().ok()?;
    Some(i16::from_le_bytes(bytes))
}

fn read_u32(buffer: &[u8], offset: usize) -> Option<u32> {
    let bytes: [u8; 4] = buffer.get(offset..offset + 4)?.try_into().ok()?;
    Some(u32::from_le_bytes(bytes))
}
