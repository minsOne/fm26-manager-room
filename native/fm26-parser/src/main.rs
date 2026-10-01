mod club;
mod container;
mod contracts;
mod metadata;
mod names;
mod person;
mod player_scan;

use anyhow::{bail, Context, Result};
use memmap2::MmapOptions;
use serde::Serialize;
use std::env;
use std::fs::File;
use std::path::PathBuf;
use std::time::Instant;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BenchReport {
    file: String,
    file_bytes: u64,
    save_name: String,
    directory_entries: usize,
    sections: usize,
    game_db_compressed_bytes: u64,
    game_db_decompressed_bytes: u64,
    index_ms: f64,
    decompress_game_db_ms: f64,
    player_scan_ms: f64,
    name_pool_ms: f64,
    person_decode_ms: f64,
    club_scan_ms: f64,
    game_info_ms: f64,
    contract_decode_ms: f64,
    total_ms: f64,
    player_scan: player_scan::PlayerScanStats,
    person_decode: person::PersonDecodeStats,
    club_scan: club::ClubScanStats,
    player_club_join: club::PlayerClubJoinStats,
    game_info: metadata::GameInfo,
    contracts: contracts::ContractStats,
}

fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "help".to_owned());

    match command.as_str() {
        "bench" => {
            let path = args
                .next()
                .map(PathBuf::from)
                .context("usage: fm26-manager-room-parser bench <save.fm>")?;
            bench(path)
        }
        "inspect" => {
            let path = args
                .next()
                .map(PathBuf::from)
                .context("usage: fm26-manager-room-parser inspect <save.fm>")?;
            inspect(path)
        }
        _ => {
            eprintln!("Usage:");
            eprintln!("  fm26-manager-room-parser inspect <save.fm>");
            eprintln!("  fm26-manager-room-parser bench <save.fm>");
            Ok(())
        }
    }
}

fn inspect(path: PathBuf) -> Result<()> {
    let file = File::open(&path)
        .with_context(|| format!("could not open {}", path.display()))?;
    let mapped = unsafe { MmapOptions::new().map(&file)? };
    let index = container::read_index(&mapped)?;
    println!("{}", serde_json::to_string_pretty(&index)?);
    Ok(())
}

fn bench(path: PathBuf) -> Result<()> {
    let total_started = Instant::now();
    let file = File::open(&path)
        .with_context(|| format!("could not open {}", path.display()))?;
    let metadata = file.metadata()?;
    let mapped = unsafe { MmapOptions::new().map(&file)? };

    let started = Instant::now();
    let index = container::read_index(&mapped)?;
    let index_ms = elapsed_ms(started);

    let game_db_entry = index
        .section("game_db")
        .context("save contains no game_db section")?
        .clone();

    let started = Instant::now();
    let game_db = container::read_section(&mapped, &game_db_entry)?;
    let decompress_game_db_ms = elapsed_ms(started);

    if game_db.is_empty() {
        bail!("game_db decompressed to zero bytes");
    }

    let started = Instant::now();
    let (player_scan, candidates) = player_scan::scan_with_candidates(&game_db);
    let player_scan_ms = elapsed_ms(started);

    let started = Instant::now();
    let name_pools = names::NamePools::locate(&game_db)?;
    let name_pool_ms = elapsed_ms(started);

    let started = Instant::now();
    let person_decode = person::decode_all(&game_db, &candidates, &name_pools)?;
    let person_decode_ms = elapsed_ms(started);

    let started = Instant::now();
    let (club_index, club_scan) = club::ClubIndex::scan(&game_db)?;
    let club_scan_ms = elapsed_ms(started);
    let player_club_join = club_index.player_join_stats(&candidates);

    let started = Instant::now();
    let game_info_entry = index
        .section("game_info")
        .context("save contains no game_info section")?
        .clone();
    let game_info_bytes = container::read_section(&mapped, &game_info_entry)?;
    let mut game_info = metadata::decode_game_info(&game_info_bytes)?;
    if game_info.game_date.is_none() {
        let summary_entry = index
            .section("save_game_summary")
            .context("save contains no save_game_summary section")?
            .clone();
        let summary_bytes = container::read_section(&mapped, &summary_entry)?;
        game_info.game_date = metadata::decode_summary_date(&summary_bytes)?;
    }
    let game_info_ms = elapsed_ms(started);
    let clock = game_info
        .game_date
        .context("FM26 save contains no readable game date")?;

    let started = Instant::now();
    let contract_stats = contracts::decode_all(&game_db, &candidates, &club_index, clock);
    let contract_decode_ms = elapsed_ms(started);

    let report = BenchReport {
        file: path.display().to_string(),
        file_bytes: metadata.len(),
        save_name: index.save_name,
        directory_entries: index.entries.len(),
        sections: index.entries.iter().filter(|entry| entry.is_section()).count(),
        game_db_compressed_bytes: game_db_entry.compressed_size,
        game_db_decompressed_bytes: game_db.len() as u64,
        index_ms,
        decompress_game_db_ms,
        player_scan_ms,
        name_pool_ms,
        person_decode_ms,
        club_scan_ms,
        game_info_ms,
        contract_decode_ms,
        total_ms: elapsed_ms(total_started),
        player_scan,
        person_decode,
        club_scan,
        player_club_join,
        game_info,
        contracts: contract_stats,
    };

    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}

fn elapsed_ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1000.0
}
