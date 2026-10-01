use crate::names::NamePools;
use crate::player_scan::PlayerCandidate;
use anyhow::{anyhow, Result};
use serde::Serialize;

const WINDOW_START_OFFSET: usize = 100;
const PERSONALITY_OFFSET_FROM_BIRTH: usize = 21;
const PERSONALITY_COUNT: usize = 8;
const DATE_ZERO_OFFSET_FROM_BIRTH: usize = 14;
const DATE_ZERO_COUNT: usize = 7;
const LEGAL_NAME_LENGTH_MIN: usize = 2;
const LEGAL_NAME_LENGTH_MAX: usize = 80;
const LEGAL_NAME_OFFSET_FROM_BLOCK_START: usize = 19;
const TRAIT_BITS_OFFSET_BEFORE_BLOCK_START: usize = 8;
const NATION_OFFSET_FROM_BIRTH: usize = 13;
const RELATION_PRESENT_OFFSET_FROM_BIRTH: usize = 37;
const RELATION_COUNT_OFFSET_FROM_BIRTH: usize = 38;
const RELATION_ENTRIES_OFFSET_FROM_BIRTH: usize = 39;
const RELATION_ENTRY_BYTES: usize = 16;
const NAME_ID_LIMIT: u32 = 1 << 23;
const MISSING_REFERENCE: u32 = u32::MAX;
const EARLIEST_GAME_YEAR: u16 = 1901;
const LATEST_GAME_YEAR: u16 = 2200;
const DAY_OF_YEAR_MASK: u16 = 0x01ff;
const TIME_SLOT_SHIFT: u16 = 9;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonCore {
    pub name: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub common_name: Option<String>,
    pub legal_name: Option<String>,
    pub birth_year: u16,
    pub birth_day_of_year: u16,
    pub nation_id: u16,
    pub personality: [u8; PERSONALITY_COUNT],
    pub trait_bits: u64,
    pub relation_count: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonDecodeStats {
    pub decoded: usize,
    pub missing: usize,
    pub name_present: usize,
    pub name_hash_fnv1a64: u64,
    pub birth_year_sum: u64,
    pub birth_day_sum: u64,
    pub nation_id_sum: u64,
    pub personality_sums: [u64; PERSONALITY_COUNT],
    pub trait_bits_xor: u64,
    pub trait_popcount_sum: u64,
    pub relation_count_sum: u64,
    pub sample: Vec<PersonCore>,
}

pub fn decode_all(
    game_db: &[u8],
    candidates: &[PlayerCandidate],
    pools: &NamePools,
) -> Result<PersonDecodeStats> {
    let mut decoded = 0usize;
    let mut missing = 0usize;
    let mut name_present = 0usize;
    let mut name_hash = FNV_OFFSET_BASIS;
    let mut birth_year_sum = 0u64;
    let mut birth_day_sum = 0u64;
    let mut nation_id_sum = 0u64;
    let mut personality_sums = [0u64; PERSONALITY_COUNT];
    let mut trait_bits_xor = 0u64;
    let mut trait_popcount_sum = 0u64;
    let mut relation_count_sum = 0u64;
    let mut sample = Vec::new();

    for (index, candidate) in candidates.iter().enumerate() {
        let window_end = candidates
            .get(index + 1)
            .map(|next| next.record_offset)
            .unwrap_or(game_db.len());

        match decode_one(game_db, candidate.record_offset, window_end, pools)? {
            Some(person) => {
                decoded += 1;
                if let Some(name) = person.name.as_deref() {
                    name_present += 1;
                    name_hash = fnv_update(name_hash, &candidate.uid.to_le_bytes());
                    name_hash = fnv_update(name_hash, name.as_bytes());
                    name_hash = fnv_update(name_hash, &[0xff]);
                }

                birth_year_sum += person.birth_year as u64;
                birth_day_sum += person.birth_day_of_year as u64;
                nation_id_sum += person.nation_id as u64;
                for (sum, value) in personality_sums.iter_mut().zip(person.personality) {
                    *sum += value as u64;
                }
                trait_bits_xor ^= person.trait_bits;
                trait_popcount_sum += person.trait_bits.count_ones() as u64;
                relation_count_sum += person.relation_count as u64;

                if sample.len() < 8 {
                    sample.push(person);
                }
            }
            None => missing += 1,
        }
    }

    Ok(PersonDecodeStats {
        decoded,
        missing,
        name_present,
        name_hash_fnv1a64: name_hash,
        birth_year_sum,
        birth_day_sum,
        nation_id_sum,
        personality_sums,
        trait_bits_xor,
        trait_popcount_sum,
        relation_count_sum,
        sample,
    })
}

fn decode_one(
    game_db: &[u8],
    record_offset: usize,
    window_end: usize,
    pools: &NamePools,
) -> Result<Option<PersonCore>> {
    let search_start = record_offset
        .checked_add(WINDOW_START_OFFSET + PERSONALITY_OFFSET_FROM_BIRTH - 1)
        .ok_or_else(|| anyhow!("person search start overflow"))?;

    if search_start >= window_end || window_end > game_db.len() {
        return Ok(None);
    }

    let mut zero_position = search_start;
    while zero_position + 1 + PERSONALITY_COUNT <= window_end {
        let Some(relative) = game_db[zero_position..window_end]
            .iter()
            .position(|byte| *byte == 0)
        else {
            return Ok(None);
        };
        zero_position += relative;

        let personality_start = zero_position + 1;
        let personality_end = personality_start + PERSONALITY_COUNT;
        if personality_end <= window_end
            && game_db[personality_start..personality_end]
                .iter()
                .all(|value| (1..=20).contains(value))
        {
            let birth_date_offset = zero_position - (PERSONALITY_OFFSET_FROM_BIRTH - 1);
            if let Some(person) = try_candidate(game_db, birth_date_offset, window_end, pools)? {
                return Ok(Some(person));
            }
        }

        zero_position += 1;
    }

    Ok(None)
}

fn try_candidate(
    game_db: &[u8],
    birth_date_offset: usize,
    window_end: usize,
    pools: &NamePools,
) -> Result<Option<PersonCore>> {
    let raw_birth_word = read_u32_opt(game_db, birth_date_offset)?;
    let packed = raw_birth_word as u16;
    let year = (raw_birth_word >> 16) as u16;
    if packed >> TIME_SLOT_SHIFT != 0 {
        return Ok(None);
    }
    let day_of_year = packed & DAY_OF_YEAR_MASK;
    if !(1..=366).contains(&day_of_year)
        || !(EARLIEST_GAME_YEAR..=LATEST_GAME_YEAR).contains(&year)
    {
        return Ok(None);
    }

    let zero_start = birth_date_offset + DATE_ZERO_OFFSET_FROM_BIRTH;
    let zero_end = zero_start + DATE_ZERO_COUNT;
    if zero_end > window_end
        || game_db
            .get(zero_start..zero_end)
            .is_none_or(|bytes| bytes.iter().any(|byte| *byte != 0))
    {
        return Ok(None);
    }

    let zero_length_at = match birth_date_offset.checked_sub(4) {
        Some(value) => value,
        None => return Ok(None),
    };
    let legal_name_length = if read_u32_opt(game_db, zero_length_at)? == 0 {
        0usize
    } else {
        let mut found = None;
        for length in LEGAL_NAME_LENGTH_MIN..=LEGAL_NAME_LENGTH_MAX {
            let Some(length_word_at) = birth_date_offset.checked_sub(4 + length) else {
                break;
            };
            if read_u32_opt(game_db, length_word_at)? as usize == length {
                found = Some(length);
                break;
            }
        }
        let Some(found) = found else {
            return Ok(None);
        };
        found
    };

    let Some(block_start) = birth_date_offset
        .checked_sub(LEGAL_NAME_OFFSET_FROM_BLOCK_START + legal_name_length)
    else {
        return Ok(None);
    };
    let Some(name_block_offset) = block_start.checked_sub(TRAIT_BITS_OFFSET_BEFORE_BLOCK_START)
    else {
        return Ok(None);
    };

    if name_block_offset + 23 > window_end {
        return Ok(None);
    }

    let trait_bits = read_u64_opt(game_db, name_block_offset)?;
    let first_name_id = read_u32_opt(game_db, name_block_offset + 8)?;
    let first_zero = game_db[name_block_offset + 12];
    let surname_id = read_u32_opt(game_db, name_block_offset + 13)?;
    let surname_zero = game_db[name_block_offset + 17];
    let common_name_id = read_u32_opt(game_db, name_block_offset + 18)?;
    let common_zero = game_db[name_block_offset + 22];

    if first_zero != 0 || surname_zero != 0 || common_zero != 0 {
        return Ok(None);
    }
    if !valid_name_id(first_name_id)
        || !valid_name_id(surname_id)
        || !valid_name_id(common_name_id)
    {
        return Ok(None);
    }

    let nation_id = read_u16_opt(game_db, birth_date_offset + NATION_OFFSET_FROM_BIRTH)?;
    let personality_start = birth_date_offset + PERSONALITY_OFFSET_FROM_BIRTH;
    let personality_end = personality_start + PERSONALITY_COUNT;
    if personality_end > window_end {
        return Ok(None);
    }
    let personality: [u8; PERSONALITY_COUNT] = game_db[personality_start..personality_end]
        .try_into()
        .expect("personality slice length checked");

    let relation_present_at = birth_date_offset + RELATION_PRESENT_OFFSET_FROM_BIRTH;
    if relation_present_at >= window_end {
        return Ok(None);
    }
    let present = game_db[relation_present_at];
    let relation_count = if present == 0 {
        0
    } else {
        let count_at = birth_date_offset + RELATION_COUNT_OFFSET_FROM_BIRTH;
        if count_at >= window_end {
            return Ok(None);
        }
        let count = game_db[count_at];
        let entries_end = birth_date_offset
            .checked_add(RELATION_ENTRIES_OFFSET_FROM_BIRTH)
            .and_then(|start| start.checked_add(RELATION_ENTRY_BYTES * count as usize))
            .ok_or_else(|| anyhow!("relation list overflow"))?;
        if entries_end > window_end {
            return Ok(None);
        }
        count
    };

    let first_name = pools.first_names.get(first_name_id).map(ToOwned::to_owned);
    let last_name = pools.surnames.get(surname_id).map(ToOwned::to_owned);
    let common_name = if common_name_id == MISSING_REFERENCE {
        None
    } else {
        pools.common_name(game_db, common_name_id)
    };

    let legal_name = if legal_name_length == 0 {
        None
    } else {
        let legal_start = block_start + LEGAL_NAME_OFFSET_FROM_BLOCK_START;
        let legal_end = legal_start + legal_name_length;
        let raw = game_db
            .get(legal_start..legal_end)
            .ok_or_else(|| anyhow!("legal name is outside game_db"))?;
        Some(
            std::str::from_utf8(raw)
                .map_err(|_| anyhow!("legal name is not UTF-8"))?
                .to_owned(),
        )
    };

    let joined = match (&first_name, &last_name) {
        (Some(first), Some(last)) => Some(format!("{first} {last}")),
        (Some(first), None) => Some(first.clone()),
        (None, Some(last)) => Some(last.clone()),
        (None, None) => None,
    };
    let name = common_name
        .clone()
        .or(joined)
        .or_else(|| legal_name.clone());

    Ok(Some(PersonCore {
        name,
        first_name,
        last_name,
        common_name,
        legal_name,
        birth_year: year,
        birth_day_of_year: day_of_year,
        nation_id,
        personality,
        trait_bits,
        relation_count,
    }))
}

fn valid_name_id(id: u32) -> bool {
    id == MISSING_REFERENCE || id < NAME_ID_LIMIT
}

fn read_u16_opt(buffer: &[u8], offset: usize) -> Result<u16> {
    let bytes: [u8; 2] = buffer
        .get(offset..offset + 2)
        .ok_or_else(|| anyhow!("u16 read outside buffer at {offset}"))?
        .try_into()
        .expect("two bytes");
    Ok(u16::from_le_bytes(bytes))
}

fn read_u32_opt(buffer: &[u8], offset: usize) -> Result<u32> {
    let bytes: [u8; 4] = buffer
        .get(offset..offset + 4)
        .ok_or_else(|| anyhow!("u32 read outside buffer at {offset}"))?
        .try_into()
        .expect("four bytes");
    Ok(u32::from_le_bytes(bytes))
}

fn read_u64_opt(buffer: &[u8], offset: usize) -> Result<u64> {
    let bytes: [u8; 8] = buffer
        .get(offset..offset + 8)
        .ok_or_else(|| anyhow!("u64 read outside buffer at {offset}"))?
        .try_into()
        .expect("eight bytes");
    Ok(u64::from_le_bytes(bytes))
}

const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

fn fnv_update(mut hash: u64, bytes: &[u8]) -> u64 {
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}
