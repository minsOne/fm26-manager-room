use anyhow::{anyhow, bail, Context, Result};
use memmap2::Mmap;
use serde::Serialize;
use std::io::Cursor;

const FILE_MAGIC: &[u8] = b"\x02\x01fmf.";
const HEADER_SIZE: usize = 26;
const TRAILER_POINTER_AT: usize = 9;
const TRAILER_HEADER_SIZE: usize = 9;
const FRAME_BASE: u64 = 26;
const ENTRY_FIXED_TAIL_BYTES: usize = 40;
const MAX_ENTRY_NAME_BYTES: usize = 256;

#[derive(Debug, Clone, Serialize)]
pub struct DirectoryEntry {
    pub name: String,
    pub extension: String,
    pub frame_offset: u64,
    pub compressed_size: u64,
    pub decompressed_size: u64,
    pub trailing_values: [u64; 2],
}

impl DirectoryEntry {
    pub fn is_section(&self) -> bool {
        self.extension == ".dat" || self.extension == ".cmt"
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ContainerIndex {
    pub save_name: String,
    pub trailer_offset: u64,
    pub entries: Vec<DirectoryEntry>,
}

impl ContainerIndex {
    pub fn section(&self, name: &str) -> Option<&DirectoryEntry> {
        self.entries.iter().find(|entry| entry.is_section() && entry.name == name)
    }
}

pub fn read_index(mapped: &Mmap) -> Result<ContainerIndex> {
    if mapped.len() < HEADER_SIZE {
        bail!("save is shorter than the 26-byte FM26 header");
    }
    if mapped.get(..FILE_MAGIC.len()) != Some(FILE_MAGIC) {
        bail!("file is not an FM26 save: bad fmf header");
    }

    let relative = read_u64(mapped, TRAILER_POINTER_AT)?;
    let trailer_offset = TRAILER_POINTER_AT as u64 + relative;
    let trailer_offset_usize = usize::try_from(trailer_offset).context("trailer offset overflow")?;

    if trailer_offset_usize < HEADER_SIZE
        || trailer_offset_usize + TRAILER_HEADER_SIZE >= mapped.len()
    {
        bail!("save directory pointer is outside the file");
    }

    let trailer = mapped
        .get(trailer_offset_usize..)
        .ok_or_else(|| anyhow!("trailer slice is outside file"))?;
    if trailer.get(..FILE_MAGIC.len()) != Some(FILE_MAGIC) {
        bail!("save directory trailer has bad fmf header");
    }

    let compressed = trailer
        .get(TRAILER_HEADER_SIZE..)
        .ok_or_else(|| anyhow!("trailer contains no compressed directory frame"))?;
    let payload = zstd::stream::decode_all(Cursor::new(compressed))
        .context("could not decompress FM26 save directory")?;

    parse_directory(&payload, trailer_offset)
}

pub fn read_section(mapped: &Mmap, entry: &DirectoryEntry) -> Result<Vec<u8>> {
    let start = usize::try_from(entry.frame_offset).context("section offset overflow")?;
    let compressed_size =
        usize::try_from(entry.compressed_size).context("compressed size overflow")?;
    let end = start
        .checked_add(compressed_size)
        .ok_or_else(|| anyhow!("section end overflow"))?;
    let compressed = mapped
        .get(start..end)
        .ok_or_else(|| anyhow!("section {}{} lies outside file", entry.name, entry.extension))?;

    let data = zstd::stream::decode_all(Cursor::new(compressed))
        .with_context(|| format!("could not decompress section {}", entry.name))?;

    if data.len() as u64 != entry.decompressed_size {
        bail!(
            "section {} decompressed to {} bytes, expected {}",
            entry.name,
            data.len(),
            entry.decompressed_size
        );
    }
    Ok(data)
}

fn parse_directory(payload: &[u8], trailer_offset: u64) -> Result<ContainerIndex> {
    let (save_name, mut cursor) = read_string(payload, 0, 4096)?;
    cursor = cursor
        .checked_add(4)
        .ok_or_else(|| anyhow!("directory cursor overflow"))?;

    let mut entries = Vec::new();
    while let Some((entry, next)) = parse_entry(payload, cursor)? {
        if entry.frame_offset + entry.compressed_size > trailer_offset {
            bail!("directory entry {} points beyond frame area", entry.name);
        }
        entries.push(entry);
        cursor = next;
        if entries.len() > 100_000 {
            bail!("implausibly many directory entries");
        }
    }

    if !entries.iter().any(DirectoryEntry::is_section) {
        bail!("directory lists no sections");
    }

    entries.sort_by_key(|entry| entry.frame_offset);
    Ok(ContainerIndex {
        save_name,
        trailer_offset,
        entries,
    })
}

fn parse_entry(payload: &[u8], cursor: usize) -> Result<Option<(DirectoryEntry, usize)>> {
    if cursor + 4 > payload.len() {
        return Ok(None);
    }

    let name_len = read_u32(payload, cursor)? as usize;
    if !(1..=MAX_ENTRY_NAME_BYTES).contains(&name_len) {
        return Ok(None);
    }

    let name_start = cursor + 4;
    let extension_length_at = name_start
        .checked_add(name_len)
        .ok_or_else(|| anyhow!("entry name overflow"))?;
    let extension_start = extension_length_at + 4;
    let tail_at = extension_start + 4;

    if tail_at + ENTRY_FIXED_TAIL_BYTES > payload.len() {
        return Ok(None);
    }
    if read_u32(payload, extension_length_at)? != 4 {
        return Ok(None);
    }

    let name_bytes = &payload[name_start..extension_length_at];
    let extension_bytes = &payload[extension_start..tail_at];

    if !name_bytes
        .iter()
        .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
    {
        return Ok(None);
    }
    if extension_bytes[0] != b'.'
        || !extension_bytes[1..].iter().all(u8::is_ascii_alphanumeric)
    {
        return Ok(None);
    }

    let relative_offset = read_u64(payload, tail_at)?;
    let compressed_size = read_u64(payload, tail_at + 8)?;
    let decompressed_size = read_u64(payload, tail_at + 16)?;
    let first_trailing = read_u64(payload, tail_at + 24)?;
    let second_trailing = read_u64(payload, tail_at + 32)?;

    let name = String::from_utf8(name_bytes.to_vec()).context("directory name is not UTF-8")?;
    let extension =
        String::from_utf8(extension_bytes.to_vec()).context("directory extension is not UTF-8")?;

    Ok(Some((
        DirectoryEntry {
            name,
            extension,
            frame_offset: FRAME_BASE + relative_offset,
            compressed_size,
            decompressed_size,
            trailing_values: [first_trailing, second_trailing],
        },
        tail_at + ENTRY_FIXED_TAIL_BYTES,
    )))
}

fn read_string(buffer: &[u8], offset: usize, max: usize) -> Result<(String, usize)> {
    let length = read_u32(buffer, offset)? as usize;
    if length > max {
        bail!("length-prefixed string exceeds limit");
    }
    let start = offset + 4;
    let end = start
        .checked_add(length)
        .ok_or_else(|| anyhow!("string end overflow"))?;
    let bytes = buffer
        .get(start..end)
        .ok_or_else(|| anyhow!("string lies outside directory payload"))?;
    let text = String::from_utf8(bytes.to_vec()).context("save name is not UTF-8")?;
    Ok((text, end))
}

fn read_u32(buffer: &[u8], offset: usize) -> Result<u32> {
    let bytes: [u8; 4] = buffer
        .get(offset..offset + 4)
        .ok_or_else(|| anyhow!("u32 read outside buffer"))?
        .try_into()
        .expect("four-byte slice");
    Ok(u32::from_le_bytes(bytes))
}

fn read_u64(buffer: &[u8], offset: usize) -> Result<u64> {
    let bytes: [u8; 8] = buffer
        .get(offset..offset + 8)
        .ok_or_else(|| anyhow!("u64 read outside buffer"))?
        .try_into()
        .expect("eight-byte slice");
    Ok(u64::from_le_bytes(bytes))
}


pub fn read_unlisted_after(
    mapped: &Mmap,
    index: &ContainerIndex,
    entry_name: &str,
) -> Result<Vec<u8>> {
    let position = index
        .entries
        .iter()
        .position(|entry| entry.name == entry_name)
        .ok_or_else(|| anyhow!("directory contains no entry named {entry_name}"))?;
    let entry = &index.entries[position];
    let start_u64 = entry
        .frame_offset
        .checked_add(entry.compressed_size)
        .ok_or_else(|| anyhow!("region start overflow after {entry_name}"))?;
    let end_u64 = index
        .entries
        .get(position + 1)
        .map(|next| next.frame_offset)
        .unwrap_or(index.trailer_offset);

    if end_u64 <= start_u64 {
        return Ok(Vec::new());
    }

    let start = usize::try_from(start_u64).context("region start does not fit usize")?;
    let end = usize::try_from(end_u64).context("region end does not fit usize")?;
    let compressed = mapped
        .get(start..end)
        .ok_or_else(|| anyhow!("unlisted region after {entry_name} lies outside file"))?;

    zstd::stream::decode_all(Cursor::new(compressed))
        .with_context(|| format!("could not decompress unlisted region after {entry_name}"))
}
