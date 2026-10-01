mod container;
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
    total_ms: f64,
    player_scan: player_scan::PlayerScanStats,
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
    let player_scan = player_scan::scan(&game_db);
    let player_scan_ms = elapsed_ms(started);

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
        total_ms: elapsed_ms(total_started),
        player_scan,
    };

    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}

fn elapsed_ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1000.0
}
