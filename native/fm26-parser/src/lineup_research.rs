//! Research evidence only: no writable format or semantic slot mapping is established.
use crate::{container, names::NamePools, person, player_scan};
use anyhow::{bail, Context, Result};
use memmap2::MmapOptions;
use serde::Serialize;
use std::{collections::HashMap, fs::File, path::PathBuf};

// Observed between two named records in one local save. Not a versioned schema.
const OBSERVED_WORD_COUNT: usize = 26;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Reference {
    word_index: usize,
    raw_value: u32,
    player_uid_candidates: Vec<u32>,
    player_name_candidates: Vec<Option<String>>,
}

/// Locate one exact length-prefixed name, rejecting ambiguous/truncated evidence.
fn words_after_name(data: &[u8], name: &str) -> Result<(usize, Vec<u32>)> {
    if name.is_empty() || name.len() > 256 {
        bail!("saved name must contain 1..256 UTF-8 bytes");
    }
    let mut marker = vec![3];
    marker.extend_from_slice(&(name.len() as u32).to_le_bytes());
    marker.extend_from_slice(name.as_bytes());
    let mut hits = memchr::memmem::find_iter(data, &marker);
    let offset = hits
        .next()
        .context("exact saved-name marker not found in tactics_man")?;
    if hits.next().is_some() {
        bail!("multiple saved-name markers; cannot resolve record identity");
    }
    let start = offset + marker.len();
    let bytes = data
        .get(start..start + OBSERVED_WORD_COUNT * 4)
        .context("truncated candidate record")?;
    let words = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| u32::from_le_bytes(*b))
        .collect();
    Ok((offset, words))
}

pub fn inspect(path: PathBuf, name: &str) -> Result<()> {
    let file = File::open(&path).context("could not open save for read-only research")?;
    let mapped = unsafe { MmapOptions::new().map(&file)? };
    let index = container::read_index(&mapped)?;
    let tactics = container::read_section(
        &mapped,
        index
            .section("tactics_man")
            .context("no tactics_man section")?,
    )?;
    let (offset, words) = words_after_name(&tactics, name)?;
    let game_db = container::read_section(
        &mapped,
        index.section("game_db").context("no game_db section")?,
    )?;
    let (_, candidates) = player_scan::scan_with_candidates(&game_db);
    let pools = NamePools::locate(&game_db)?;
    let (_, people) = person::decode_all_with_people(&game_db, &candidates, &pools)?;
    let mut by_index = HashMap::<u32, Vec<usize>>::new();
    for (i, candidate) in candidates.iter().enumerate() {
        if let Some(reference) = candidate.pindex.checked_add(1) {
            by_index.entry(reference).or_default().push(i);
        }
    }
    let references: Vec<_> = words
        .into_iter()
        .enumerate()
        .map(|(word_index, raw_value)| {
            let matches = by_index.get(&raw_value).cloned().unwrap_or_default();
            Reference {
                word_index,
                raw_value,
                player_uid_candidates: matches.iter().map(|&i| candidates[i].uid).collect(),
                player_name_candidates: matches
                    .iter()
                    .map(|&i| {
                        people
                            .get(i)
                            .and_then(Option::as_ref)
                            .and_then(|p| p.name.clone())
                    })
                    .collect(),
            }
        })
        .collect();
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "schemaVersion": 1,
            "mode": "read-only-research",
            "lineupFormatVerified": false,
            "slotMappingVerified": false,
            "writeSupported": false,
            "section": "tactics_man",
            "markerOffset": offset,
            "savedName": name,
            "observedWordCount": OBSERVED_WORD_COUNT,
            "referenceHypothesis": "raw_value == player.pindex + 1",
            "note": "Candidate one-based pindex joins only. Order, empty sentinel and record extent need game reload and one-player differential validation. Never use these offsets for writes.",
            "references": references
        }))?
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(name: &str) -> Vec<u8> {
        let mut data = vec![3];
        data.extend_from_slice(&(name.len() as u32).to_le_bytes());
        data.extend_from_slice(name.as_bytes());
        for value in 0..OBSERVED_WORD_COUNT as u32 {
            data.extend_from_slice(&value.to_le_bytes());
        }
        data
    }

    #[test]
    fn exact_utf8_name_and_little_endian_words() {
        let data = record("선발 A");
        let (offset, words) = words_after_name(&data, "선발 A").unwrap();
        assert_eq!(offset, 0);
        assert_eq!(words, (0..26).collect::<Vec<_>>());
        assert!(words_after_name(&data, "선발").is_err());
    }

    #[test]
    fn rejects_ambiguous_or_truncated_records() {
        let data = record("test");
        assert!(words_after_name(&[data.clone(), data.clone()].concat(), "test").is_err());
        assert!(words_after_name(&data[..data.len() - 1], "test").is_err());
    }

    #[test]
    fn rejects_plain_strings_and_invalid_lengths() {
        assert!(words_after_name(b"test", "test").is_err());
        assert!(words_after_name(&record("test"), "").is_err());
        assert!(words_after_name(&record("test"), &"x".repeat(257)).is_err());
    }
}

/// UID joins for the guarded copy writer; ambiguous references are omitted.
pub fn player_references(path: PathBuf) -> Result<()> {
    let file = File::open(path)?;
    let mapped = unsafe { MmapOptions::new().map(&file)? };
    let index = container::read_index(&mapped)?;
    let db = container::read_section(&mapped, index.section("game_db").context("no game_db")?)?;
    let (_, candidates) = player_scan::scan_with_candidates(&db);
    let mut by_uid = HashMap::<u32, Vec<u32>>::new();
    let mut counts = HashMap::<u32, usize>::new();
    for c in candidates {
        if let Some(reference) = c.pindex.checked_add(1).filter(|r| *r != u32::MAX) {
            by_uid.entry(c.uid).or_default().push(reference);
            *counts.entry(reference).or_default() += 1;
        }
    }
    let result: HashMap<_, _> = by_uid.into_iter().filter_map(|(uid, refs)| {
        (refs.len() == 1 && counts[&refs[0]] == 1).then(|| (uid.to_string(), refs[0]))
    }).collect();
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}
