mod container;

use anyhow::{bail, Result};
use container::ContainerIndex;
use serde::Serialize;
use std::{env, hint::black_box, path::PathBuf, time::Instant};

#[derive(Serialize)]
struct BenchResult {
    file_bytes: u64,
    save_name: String,
    directory_entries: usize,
    sections: usize,
    index_ms: f64,
    section: Option<SectionBench>,
    total_ms: f64,
}

#[derive(Serialize)]
struct SectionBench {
    name: String,
    compressed_bytes: u64,
    decompressed_bytes: usize,
    expected_decompressed_bytes: u64,
    decompress_ms: f64,
    checksum_sample: u64,
}

fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "help".into());
    match command.as_str() {
        "info" => {
            let path = required_path(args.next())?;
            let started = Instant::now();
            let index = ContainerIndex::open(path)?;
            let result = BenchResult {
                file_bytes: index.file_size,
                save_name: index.save_name.clone(),
                directory_entries: index.entries.len(),
                sections: index.entries.iter().filter(|e| e.is_section()).count(),
                index_ms: ms(started.elapsed()),
                section: None,
                total_ms: ms(started.elapsed()),
            };
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        "bench" => {
            let path = required_path(args.next())?;
            let section_name = args.next().unwrap_or_else(|| "game_db".into());
            let total = Instant::now();
            let index_started = Instant::now();
            let index = ContainerIndex::open(&path)?;
            let index_ms = ms(index_started.elapsed());
            let entry = index.section(&section_name).cloned();
            let section = if let Some(entry) = entry {
                let started = Instant::now();
                let data = index.read_section(&section_name)?;
                let checksum_sample = data
                    .iter()
                    .step_by((data.len() / 4096).max(1))
                    .fold(0u64, |acc, byte| acc.wrapping_mul(16777619) ^ u64::from(*byte));
                black_box(&data);
                Some(SectionBench {
                    name: section_name,
                    compressed_bytes: entry.compressed_size,
                    decompressed_bytes: data.len(),
                    expected_decompressed_bytes: entry.decompressed_size,
                    decompress_ms: ms(started.elapsed()),
                    checksum_sample,
                })
            } else {
                None
            };
            let result = BenchResult {
                file_bytes: index.file_size,
                save_name: index.save_name.clone(),
                directory_entries: index.entries.len(),
                sections: index.entries.iter().filter(|e| e.is_section()).count(),
                index_ms,
                section,
                total_ms: ms(total.elapsed()),
            };
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        _ => bail!("usage: fm26-manager-room-parser <info|bench> <save.fm> [section]"),
    }
    Ok(())
}

fn required_path(value: Option<String>) -> Result<PathBuf> {
    value.map(PathBuf::from).ok_or_else(|| anyhow::anyhow!("missing save path"))
}

fn ms(duration: std::time::Duration) -> f64 {
    duration.as_secs_f64() * 1000.0
}
