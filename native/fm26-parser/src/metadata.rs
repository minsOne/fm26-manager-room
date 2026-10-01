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
    if let Some(date) = contract::decode_date(&game_info, date_at) {
        let packed = read_u16(&game_info, date_at)
            .ok_or_else(|| anyhow!("game_info date word is truncated"))?;
        return Ok(SaveClock {
            db_version,
            date,
            time_slot: packed >> 9,
        });
    }

    let date = read_summary_date(mapped, index)?
        .ok_or_else(|| anyhow!("neither game_info nor save_game_summary contains a valid FM26 game date"))?;

    Ok(SaveClock {
        db_version,
        date,
        time_slot: 0,
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


fn read_summary_date(mapped: &Mmap, index: &ContainerIndex) -> Result<Option<GameDate>> {
    let Some(entry) = index.section("save_game_summary") else {
        return Ok(None);
    };
    let summary = container::read_section(mapped, entry)?;
    let mut offset = 8usize;

    let (_setup, next) = read_string(&summary, offset, 65_536)?;
    offset = next;
    let (_build, next) = read_string(&summary, offset, 32)?;
    offset = next;

    let division_count = read_u32(&summary, offset)
        .ok_or_else(|| anyhow!("summary division count is truncated"))? as usize;
    if division_count > 4_096 {
        return Ok(None);
    }
    offset += 4;

    for _ in 0..division_count {
        let (_division, next) = read_string(&summary, offset, 1_024)?;
        offset = next;
    }

    offset = offset.saturating_add(8);
    let (_manager, next) = read_string(&summary, offset, 1_024)?;
    offset = next;
    let (_club, next) = read_string(&summary, offset, 1_024)?;
    offset = next.saturating_add(4);

    Ok(contract::decode_date(&summary, offset))
}

fn read_string(buffer: &[u8], offset: usize, max: usize) -> Result<(String, usize)> {
    let length = read_u32(buffer, offset)
        .ok_or_else(|| anyhow!("length-prefixed string is truncated at {offset}"))? as usize;
    if length > max {
        bail!("length-prefixed string at {offset} exceeds {max} bytes");
    }
    let start = offset + 4;
    let end = start
        .checked_add(length)
        .ok_or_else(|| anyhow!("string end overflow"))?;
    let text = std::str::from_utf8(
        buffer
            .get(start..end)
            .ok_or_else(|| anyhow!("length-prefixed string runs past section end"))?,
    )?
    .to_owned();
    Ok((text, end))
}
