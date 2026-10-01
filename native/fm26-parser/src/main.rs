mod club;
mod contract;
mod finance;
mod fixture;
mod container;
mod names;
mod managed;
mod match_history;
mod person;
mod player_scan;
mod snapshot;

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
    contract_ms: f64,
    match_history_ms: f64,
    finance_ms: f64,
    span_decompress_ms: f64,
    fixture_ms: f64,
    span_bytes: usize,
    total_ms: f64,
    player_scan: player_scan::PlayerScanStats,
    person_decode: person::PersonDecodeStats,
    club_scan: club::ClubScanStats,
    player_club_join: club::PlayerClubJoinStats,
    contracts: contract::ContractStats,
    match_history: match_history::MatchHistoryStats,
    finance: finance::FinanceStats,
    fixtures: fixture::FixtureStats,
}

fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "help".to_owned());

    match command.as_str() {
        "bench" => {
            let path = args
                .next()
                .map(PathBuf::from)
                .context("usage: fm26-manager-room-parser bench <save.fm> --clock YYYY-MM-DD")?;
            let mut clock = None;
            while let Some(flag) = args.next() {
                if flag == "--clock" {
                    let value = args.next().context("--clock needs YYYY-MM-DD")?;
                    clock = Some(parse_clock(&value)?);
                }
            }
            let clock = clock.context("bench requires --clock YYYY-MM-DD")?;
            bench(path, clock)
        }
        "snapshot" => {
            let path = args
                .next()
                .map(PathBuf::from)
                .context("usage: fm26-manager-room-parser snapshot <save.fm> --clock YYYY-MM-DD [--club-uid N] [--pretty]")?;
            let mut clock = None;
            let mut club_uid = None;
            let mut pretty = false;
            while let Some(flag) = args.next() {
                match flag.as_str() {
                    "--clock" => {
                        let value = args.next().context("--clock needs YYYY-MM-DD")?;
                        clock = Some(parse_clock(&value)?);
                    }
                    "--club-uid" => {
                        let value = args.next().context("--club-uid needs an integer")?;
                        club_uid = Some(value.parse::<u32>()?);
                    }
                    "--pretty" => pretty = true,
                    _ => bail!("unknown snapshot option: {flag}"),
                }
            }
            snapshot_command(
                path,
                clock.context("snapshot requires --clock YYYY-MM-DD")?,
                club_uid,
                pretty,
            )
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
            eprintln!("  fm26-manager-room-parser bench <save.fm> --clock YYYY-MM-DD");
            eprintln!("  fm26-manager-room-parser snapshot <save.fm> --clock YYYY-MM-DD [--club-uid N] [--pretty]");
            Ok(())
        }
    }
}


fn snapshot_command(
    path: PathBuf,
    clock: contract::GameDate,
    club_uid: Option<u32>,
    pretty: bool,
) -> Result<()> {
    let file = File::open(&path)
        .with_context(|| format!("could not open {}", path.display()))?;
    let mapped = unsafe { MmapOptions::new().map(&file)? };
    let index = container::read_index(&mapped)?;
    let game_db_entry = index
        .section("game_db")
        .context("save contains no game_db section")?
        .clone();
    let game_db = container::read_section(&mapped, &game_db_entry)?;

    let (_scan, candidates) = player_scan::scan_with_candidates(&game_db);
    let name_pools = names::NamePools::locate(&game_db)?;
    let (people, _person_stats) = person::decode_all(&game_db, &candidates, &name_pools)?;
    let (club_index, _club_stats) = club::ClubIndex::scan(&game_db)?;
    let resolved_club_uid = match club_uid {
        Some(value) => value,
        None => managed::detect(&mapped, &index, &game_db, &club_index, clock)?
            .context("could not detect the managed club from the humans section")?
            .club_uid,
    };
    let (contracts, _contract_stats) =
        contract::decode_all(&game_db, &candidates, &club_index, clock);
    let (recent_minutes, _match_stats) =
        match_history::recent_minutes_all(&game_db, &candidates, clock);
    let (finances, _finance_stats) = finance::read_latest(&game_db, &club_index);
    let span = container::read_unlisted_after(&mapped, &index, "non_pl_hist_ls")?;
    let (fixtures, _fixture_stats) =
        fixture::managed_upcoming(&span, &club_index, resolved_club_uid, clock, 12);

    let value = snapshot::build(
        index.save_name,
        &game_db,
        &candidates,
        &people,
        &club_index,
        &contracts,
        &recent_minutes,
        &finances,
        fixtures,
        clock,
        resolved_club_uid,
    );

    if pretty {
        println!("{}", serde_json::to_string_pretty(&value)?);
    } else {
        println!("{}", serde_json::to_string(&value)?);
    }
    Ok(())
}

fn inspect(path: PathBuf) -> Result<()> {
    let file = File::open(&path)
        .with_context(|| format!("could not open {}", path.display()))?;
    let mapped = unsafe { MmapOptions::new().map(&file)? };
    let index = container::read_index(&mapped)?;
    println!("{}", serde_json::to_string_pretty(&index)?);
    Ok(())
}

fn bench(path: PathBuf, clock: contract::GameDate) -> Result<()> {
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
    let (_people, person_decode) = person::decode_all(&game_db, &candidates, &name_pools)?;
    let person_decode_ms = elapsed_ms(started);

    let started = Instant::now();
    let (club_index, club_scan) = club::ClubIndex::scan(&game_db)?;
    let club_scan_ms = elapsed_ms(started);
    let player_club_join = club_index.player_join_stats(&candidates);

    let started = Instant::now();
    let (_contracts, contracts) = contract::decode_all(&game_db, &candidates, &club_index, clock);
    let contract_ms = elapsed_ms(started);

    let started = Instant::now();
    let (_recent_minutes, match_history) =
        match_history::recent_minutes_all(&game_db, &candidates, clock);
    let match_history_ms = elapsed_ms(started);

    let started = Instant::now();
    let (_finances, finance) = finance::read_latest(&game_db, &club_index);
    let finance_ms = elapsed_ms(started);

    let started = Instant::now();
    let span = container::read_unlisted_after(&mapped, &index, "non_pl_hist_ls")?;
    let span_decompress_ms = elapsed_ms(started);
    let span_bytes = span.len();

    let started = Instant::now();
    let managed_for_fixture = managed::detect(&mapped, &index, &game_db, &club_index, clock)?
        .map(|row| row.club_uid)
        .unwrap_or(0);
    let (_fixture_rows, fixtures) =
        fixture::managed_upcoming(&span, &club_index, managed_for_fixture, clock, 12);
    let fixture_ms = elapsed_ms(started);

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
        contract_ms,
        match_history_ms,
        finance_ms,
        span_decompress_ms,
        fixture_ms,
        span_bytes,
        total_ms: elapsed_ms(total_started),
        player_scan,
        person_decode,
        club_scan,
        player_club_join,
        contracts,
        match_history,
        finance,
        fixtures,
    };

    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}

fn elapsed_ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1000.0
}


fn parse_clock(value: &str) -> Result<contract::GameDate> {
    let mut parts = value.split('-');
    let year: u16 = parts.next().context("clock year missing")?.parse()?;
    let month: u8 = parts.next().context("clock month missing")?.parse()?;
    let day: u8 = parts.next().context("clock day missing")?.parse()?;
    if parts.next().is_some() || !(1..=12).contains(&month) {
        bail!("clock must be YYYY-MM-DD");
    }
    let leap = year % 400 == 0 || (year % 4 == 0 && year % 100 != 0);
    let month_days = [31u16, if leap {29} else {28}, 31,30,31,30,31,31,30,31,30,31];
    let max_day = month_days[(month - 1) as usize];
    if day == 0 || day as u16 > max_day {
        bail!("invalid clock date");
    }
    let day_of_year = month_days[..(month - 1) as usize].iter().sum::<u16>() + day as u16;
    Ok(contract::GameDate { year, day_of_year })
}
