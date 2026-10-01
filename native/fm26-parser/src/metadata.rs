use anyhow::{anyhow, Result};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDate {
    pub year: u16,
    pub day_of_year: u16,
}

impl GameDate {
    pub fn ordinal_key(self) -> u64 {
        self.year as u64 * 400 + self.day_of_year as u64
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameInfo {
    pub db_version: String,
    pub game_date: Option<GameDate>,
    pub time_slot: u16,
}

pub fn decode_game_info(section: &[u8]) -> Result<GameInfo> {
    let length = read_u32(section, 8)? as usize;
    if length > 64 {
        return Err(anyhow!("game_info database version is too long"));
    }
    let text_start = 12usize;
    let text_end = text_start
        .checked_add(length)
        .ok_or_else(|| anyhow!("db version end overflow"))?;
    let db_version = std::str::from_utf8(
        section
            .get(text_start..text_end)
            .ok_or_else(|| anyhow!("db version outside game_info"))?,
    )
    .map_err(|_| anyhow!("db version is not UTF-8"))?
    .to_owned();

    let date_at = text_end
        .checked_add(172)
        .ok_or_else(|| anyhow!("game date offset overflow"))?;
    let raw = read_u32(section, date_at)?;
    let game_date = decode_date_raw(raw);
    let packed = raw as u16;
    let time_slot = packed >> 9;

    Ok(GameInfo {
        db_version,
        game_date,
        time_slot,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryInfo {
    pub manager_name: String,
    pub club_name: String,
    pub club_uid: u32,
    pub game_date: Option<GameDate>,
}

pub fn decode_summary(section: &[u8]) -> Result<SummaryInfo> {
    let (_, mut offset) = read_string(section, 8, 65_536)?;
    let (_, next) = read_string(section, offset, 32)?;
    offset = next;

    let division_count = read_u32(section, offset)? as usize;
    if division_count > 4_096 {
        return Err(anyhow!("save summary division count exceeds limit"));
    }
    offset += 4;

    for _ in 0..division_count {
        let (_, next) = read_string(section, offset, 1_024)?;
        offset = next;
    }

    let (manager_name, next) = read_string(section, offset + 8, 1_024)?;
    offset = next;
    let (club_name, next) = read_string(section, offset, 1_024)?;
    offset = next;

    let club_uid = read_u32(section, offset)?;
    let game_date = decode_date_at(section, offset + 4);

    Ok(SummaryInfo {
        manager_name,
        club_name,
        club_uid,
        game_date,
    })
}

pub fn decode_summary_date(section: &[u8]) -> Result<Option<GameDate>> {
    Ok(decode_summary(section)?.game_date)
}

pub fn decode_date_at(buffer: &[u8], offset: usize) -> Option<GameDate> {
    let bytes: [u8; 4] = buffer.get(offset..offset + 4)?.try_into().ok()?;
    decode_date_raw(u32::from_le_bytes(bytes))
}

pub fn decode_date_raw(raw: u32) -> Option<GameDate> {
    let packed = raw as u16;
    let year = (raw >> 16) as u16;
    let day = packed & 0x01ff;
    if !(1901..=2200).contains(&year) {
        return None;
    }
    let max = if leap(year) { 366 } else { 365 };
    if !(1..=max).contains(&day) {
        return None;
    }
    Some(GameDate {
        year,
        day_of_year: day,
    })
}

fn leap(year: u16) -> bool {
    let year = year as u32;
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn read_string(buffer: &[u8], offset: usize, max: usize) -> Result<(String, usize)> {
    let length = read_u32(buffer, offset)? as usize;
    if length > max {
        return Err(anyhow!("length-prefixed string exceeds limit"));
    }
    let start = offset + 4;
    let end = start
        .checked_add(length)
        .ok_or_else(|| anyhow!("string end overflow"))?;
    let raw = buffer
        .get(start..end)
        .ok_or_else(|| anyhow!("string outside section"))?;
    let text = std::str::from_utf8(raw)
        .map_err(|_| anyhow!("summary string is not UTF-8"))?
        .to_owned();
    Ok((text, end))
}

fn read_u32(buffer: &[u8], offset: usize) -> Result<u32> {
    let bytes: [u8; 4] = buffer
        .get(offset..offset + 4)
        .ok_or_else(|| anyhow!("u32 read outside buffer at {offset}"))?
        .try_into()
        .expect("four bytes");
    Ok(u32::from_le_bytes(bytes))
}
