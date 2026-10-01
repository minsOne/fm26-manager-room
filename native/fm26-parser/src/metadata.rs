use crate::container::{self, ContainerIndex};
use crate::contract::{self, GameDate};
use anyhow::{anyhow, bail, Result};
use memmap2::Mmap;

const DB_VERSION_LENGTH_OFFSET: usize = 8;
const MAX_DB_VERSION_BYTES: usize = 64;
const GAME_DATE_AFTER_DB_VERSION: usize = 172;

#[derive(Debug, Clone)]
pub struct SaveClock {
    pub db_version: String,
    pub date: GameDate,
    pub time_slot: u16,
}

pub fn read_clock(mapped: &Mmap, index: &ContainerIndex) -> Result<SaveClock> {
    let entry = index
        .section("game_info")
        .ok_or_else(|| anyhow!("save contains no game_info section"))?;
    let game_info = container::read_section(mapped, entry)?;

    let length = read_u32(&game_info, DB_VERSION_LENGTH_OFFSET)
        .ok_or_else(|| anyhow!("game_info db-version length is missing"))? as usize;
    if length > MAX_DB_VERSION_BYTES {
        bail!("game_info db-version string is implausibly long: {length}");
    }
    let text_start = DB_VERSION_LENGTH_OFFSET + 4;
    let text_end = text_start
        .checked_add(length)
        .ok_or_else(|| anyhow!("db-version string end overflow"))?;
    let db_version = std::str::from_utf8(
        game_info
            .get(text_start..text_end)
            .ok_or_else(|| anyhow!("game_info db-version string is truncated"))?,
    )?
    .to_owned();

    let date_at = text_end
        .checked_add(GAME_DATE_AFTER_DB_VERSION)
        .ok_or_else(|| anyhow!("game-date offset overflow"))?;
    let date = contract::decode_date(&game_info, date_at)
        .ok_or_else(|| anyhow!("game_info contains no valid FM26 game date at the known layout"))?;
    let packed = read_u16(&game_info, date_at)
        .ok_or_else(|| anyhow!("game_info date word is truncated"))?;
    let time_slot = packed >> 9;

    Ok(SaveClock {
        db_version,
        date,
        time_slot,
    })
}

fn read_u16(buffer: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        buffer.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn read_u32(buffer: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        buffer.get(offset..offset + 4)?.try_into().ok()?,
    ))
}
