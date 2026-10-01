use anyhow::{anyhow, bail, Result};
use memchr::memmem;

const SIGNATURE_WORDS: [u32; 6] = [46421, 0, 1024, 256, 2048, 0];
const MAX_NAME_BYTES: usize = 64;
const MISSING_REFERENCE: u32 = u32::MAX;

#[derive(Debug)]
pub struct NamePool {
    names: Vec<Option<String>>,
}

impl NamePool {
    pub fn get(&self, index: u32) -> Option<&str> {
        if index == MISSING_REFERENCE {
            return None;
        }
        self.names.get(index as usize)?.as_deref()
    }
}

#[derive(Debug)]
pub struct NamePools {
    pub first_names: NamePool,
    pub surnames: NamePool,
    pub common_names: NamePool,
    pub end_offset: usize,
}

impl NamePools {
    pub fn locate(game_db: &[u8]) -> Result<Self> {
        let signature = signature_bytes();
        let mut hits = memmem::find_iter(game_db, &signature);
        let signature_at = hits.next().ok_or_else(|| anyhow!("name-pool signature not found"))?;
        if hits.next().is_some() {
            bail!("name-pool signature is not unique");
        }

        let mut cursor = signature_at + signature.len();
        let (first_names, next) = read_pool(game_db, cursor)?;
        cursor = next;
        let (surnames, next) = read_pool(game_db, cursor)?;
        cursor = next;
        let (common_names, next) = read_pool(game_db, cursor)?;
        cursor = next;

        Ok(Self {
            first_names,
            surnames,
            common_names,
            end_offset: cursor,
        })
    }

    pub fn common_name(&self, game_db: &[u8], id: u32) -> Option<String> {
        let _ = game_db;
        self.common_names
            .get(id)
            .or_else(|| self.first_names.get(id))
            .or_else(|| self.surnames.get(id))
            .map(ToOwned::to_owned)
    }
}

fn read_pool(game_db: &[u8], count_at: usize) -> Result<(NamePool, usize)> {
    let entry_count = read_u32(game_db, count_at)? as usize;
    let mut position = count_at
        .checked_add(4)
        .ok_or_else(|| anyhow!("name pool cursor overflow"))?;
    let mut names = Vec::with_capacity(entry_count);

    for expected_id in 0..entry_count {
        let entry_id = read_u32(game_db, position)? as usize;
        let name_length = read_u32(game_db, position + 4)? as usize;
        if entry_id != expected_id {
            bail!("name pool entry id mismatch: expected {expected_id}, found {entry_id}");
        }
        if name_length > MAX_NAME_BYTES {
            bail!("name pool entry {entry_id} is too long");
        }

        let text_start = position + 8;
        let text_end = text_start
            .checked_add(name_length)
            .ok_or_else(|| anyhow!("name end overflow"))?;
        let raw = game_db
            .get(text_start..text_end)
            .ok_or_else(|| anyhow!("name pool runs past game_db"))?;

        if raw.is_empty() {
            names.push(None);
        } else {
            names.push(Some(
                std::str::from_utf8(raw)
                    .map_err(|_| anyhow!("name pool contains invalid UTF-8"))?
                    .to_owned(),
            ));
        }
        position = text_end;
    }

    Ok((NamePool { names }, position))
}

fn signature_bytes() -> Vec<u8> {
    SIGNATURE_WORDS
        .into_iter()
        .flat_map(u32::to_le_bytes)
        .collect()
}

fn read_u32(buffer: &[u8], offset: usize) -> Result<u32> {
    let bytes: [u8; 4] = buffer
        .get(offset..offset + 4)
        .ok_or_else(|| anyhow!("u32 read outside buffer at {offset}"))?
        .try_into()
        .expect("four bytes");
    Ok(u32::from_le_bytes(bytes))
}
