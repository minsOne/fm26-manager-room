use crate::club::ClubIndex;
use crate::container::{self, ContainerIndex};
use crate::contract::{self, GameDate};
use anyhow::{anyhow, Result};
use memmap2::Mmap;
use serde::Serialize;

const HUMAN_COUNT_OFFSET: usize = 8;
const FIRST_SELECTOR_OFFSET: usize = 10;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedClubDetection {
    pub human_count: u16,
    pub selector: u32,
    pub club_uid: u32,
}

pub fn detect(
    mapped: &Mmap,
    index: &ContainerIndex,
    game_db: &[u8],
    clubs: &ClubIndex,
    clock: GameDate,
) -> Result<Option<ManagedClubDetection>> {
    let Some(entry) = index.section("humans") else {
        return Ok(None);
    };
    let humans = container::read_section(mapped, entry)?;
    let human_count = read_u16(&humans, HUMAN_COUNT_OFFSET)
        .ok_or_else(|| anyhow!("humans section is shorter than the human-count field"))?;
    if human_count == 0 {
        return Ok(None);
    }
    let selector = read_u32(&humans, FIRST_SELECTOR_OFFSET)
        .ok_or_else(|| anyhow!("humans section is shorter than the first selector"))?;
    if selector == 0 || selector == u32::MAX {
        return Ok(None);
    }
    let Some(club_uid) = contract::managed_club_for_selector(game_db, selector, clubs, clock) else {
        return Ok(None);
    };
    Ok(Some(ManagedClubDetection {
        human_count,
        selector,
        club_uid,
    }))
}

fn read_u16(buffer: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(buffer.get(offset..offset + 2)?.try_into().ok()?))
}

fn read_u32(buffer: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(buffer.get(offset..offset + 4)?.try_into().ok()?))
}
