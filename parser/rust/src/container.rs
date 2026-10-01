use anyhow::{anyhow, bail, Context, Result};
use memmap2::Mmap;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs::File, path::{Path, PathBuf}};

const FILE_MAGIC: &[u8; 6] = b"\x02\x01fmf.";
const HEADER_SIZE: usize = 26;
const TRAILER_POINTER_AT: usize = 9;
const TRAILER_HEADER_SIZE: usize = 9;
const FRAME_BASE: u64 = 26;
const MAX_TRAILER_BYTES: usize = 64 * 1024 * 1024;

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
        matches!(self.extension.as_str(), ".dat" | ".cmt")
    }
}

#[derive(Debug, Serialize)]
pub struct ContainerIndex {
    #[serde(skip)]
    pub path: PathBuf,
    pub file_size: u64,
    pub save_name: String,
    pub trailer_offset: u64,
    pub header_trailer_sha256: String,
    pub entries: Vec<DirectoryEntry>,
}

impl ContainerIndex {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let file = File::open(&path).with_context(|| format!("open {}", path.display()))?;
        let file_size = file.metadata()?.len();
        let mmap = unsafe { Mmap::map(&file)? };
        if mmap.len() < HEADER_SIZE || &mmap[..FILE_MAGIC.len()] != FILE_MAGIC {
            bail!("not an FM26 fmf save");
        }
        let relative = read_u64(&mmap, TRAILER_POINTER_AT)?;
        let trailer_offset = TRAILER_POINTER_AT as u64 + relative;
        let trailer_offset_usize = usize::try_from(trailer_offset)?;
        if trailer_offset_usize < HEADER_SIZE || trailer_offset_usize + TRAILER_HEADER_SIZE >= mmap.len() {
            bail!("invalid trailer offset");
        }
        let trailer = &mmap[trailer_offset_usize..];
        if trailer.len() > MAX_TRAILER_BYTES {
            bail!("trailer too large");
        }
        if trailer.len() < TRAILER_HEADER_SIZE || &trailer[..FILE_MAGIC.len()] != FILE_MAGIC {
            bail!("invalid trailer magic");
        }

        let trailer_payload = zstd::bulk::decompress(
            &trailer[TRAILER_HEADER_SIZE..],
            MAX_TRAILER_BYTES,
        ).context("decompress save directory")?;

        let (save_name, entries) = parse_directory(&trailer_payload, trailer_offset)?;

        let mut hasher = Sha256::new();
        hasher.update(&mmap[..HEADER_SIZE]);
        hasher.update(trailer);
        let header_trailer_sha256 = format!("{:x}", hasher.finalize());

        Ok(Self {
            path,
            file_size,
            save_name,
            trailer_offset,
            header_trailer_sha256,
            entries,
        })
    }

    pub fn section(&self, name: &str) -> Option<&DirectoryEntry> {
        self.entries.iter().find(|entry| entry.is_section() && entry.name == name)
    }

    pub fn read_section(&self, name: &str) -> Result<Vec<u8>> {
        let entry = self.section(name).ok_or_else(|| anyhow!("section {name:?} not found"))?;
        let file = File::open(&self.path)?;
        let mmap = unsafe { Mmap::map(&file)? };
        let start = usize::try_from(entry.frame_offset)?;
        let size = usize::try_from(entry.compressed_size)?;
        let end = start.checked_add(size).ok_or_else(|| anyhow!("section range overflow"))?;
        let compressed = mmap.get(start..end).ok_or_else(|| anyhow!("section outside file"))?;
        let expected = usize::try_from(entry.decompressed_size)?;
        let data = zstd::bulk::decompress(compressed, expected)
            .with_context(|| format!("decompress section {name}"))?;
        if data.len() != expected {
            bail!("section {name} decoded to {}, expected {expected}", data.len());
        }
        Ok(data)
    }
}

fn parse_directory(bytes: &[u8], trailer_offset: u64) -> Result<(String, Vec<DirectoryEntry>)> {
    let mut cursor = 0usize;
    let save_name = read_lp_string(bytes, &mut cursor, 4096)?;
    cursor = cursor.checked_add(4).ok_or_else(|| anyhow!("directory cursor overflow"))?;

    let mut entries = Vec::new();
    let mut previous_end = HEADER_SIZE as u64;
    while let Some((entry, next)) = parse_entry(bytes, cursor)? {
        if entry.compressed_size == 0
            || entry.frame_offset < previous_end
            || entry.frame_offset.saturating_add(entry.compressed_size) > trailer_offset
        {
            bail!("directory entry {}{} outside frame area", entry.name, entry.extension);
        }
        previous_end = entry.frame_offset + entry.compressed_size;
        entries.push(entry);
        cursor = next;
        if entries.len() > 100_000 {
            bail!("too many directory entries");
        }
    }
    if !entries.iter().any(DirectoryEntry::is_section) {
        bail!("save directory contains no sections");
    }
    Ok((save_name, entries))
}

fn parse_entry(bytes: &[u8], cursor: usize) -> Result<Option<(DirectoryEntry, usize)>> {
    if cursor + 4 > bytes.len() {
        return Ok(None);
    }
    let name_len = read_u32(bytes, cursor)? as usize;
    if !(1..=256).contains(&name_len) {
        return Ok(None);
    }
    let name_start = cursor + 4;
    let ext_len_at = name_start.checked_add(name_len).ok_or_else(|| anyhow!("entry overflow"))?;
    if ext_len_at + 8 + 40 > bytes.len() {
        return Ok(None);
    }
    let name_bytes = &bytes[name_start..ext_len_at];
    if !name_bytes.iter().all(|b| b.is_ascii_alphanumeric() || *b == b'_') {
        return Ok(None);
    }
    if read_u32(bytes, ext_len_at)? != 4 {
        return Ok(None);
    }
    let ext_start = ext_len_at + 4;
    let ext = bytes.get(ext_start..ext_start + 4).ok_or_else(|| anyhow!("extension overflow"))?;
    if ext.first() != Some(&b'.') || !ext[1..].iter().all(u8::is_ascii_alphanumeric) {
        return Ok(None);
    }
    let tail = ext_start + 4;
    let relative = read_u64(bytes, tail)?;
    let compressed_size = read_u64(bytes, tail + 8)?;
    let decompressed_size = read_u64(bytes, tail + 16)?;
    let trailing0 = read_u64(bytes, tail + 24)?;
    let trailing1 = read_u64(bytes, tail + 32)?;
    let entry = DirectoryEntry {
        name: std::str::from_utf8(name_bytes)?.to_owned(),
        extension: std::str::from_utf8(ext)?.to_owned(),
        frame_offset: FRAME_BASE + relative,
        compressed_size,
        decompressed_size,
        trailing_values: [trailing0, trailing1],
    };
    Ok(Some((entry, tail + 40)))
}

fn read_lp_string(bytes: &[u8], cursor: &mut usize, max: usize) -> Result<String> {
    let len = read_u32(bytes, *cursor)? as usize;
    if len > max {
        bail!("length-prefixed string too large");
    }
    *cursor += 4;
    let end = cursor.checked_add(len).ok_or_else(|| anyhow!("string overflow"))?;
    let value = std::str::from_utf8(bytes.get(*cursor..end).ok_or_else(|| anyhow!("short string"))?)?.to_owned();
    *cursor = end;
    Ok(value)
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32> {
    let raw: [u8; 4] = bytes.get(offset..offset + 4).ok_or_else(|| anyhow!("short u32"))?.try_into()?;
    Ok(u32::from_le_bytes(raw))
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64> {
    let raw: [u8; 8] = bytes.get(offset..offset + 8).ok_or_else(|| anyhow!("short u64"))?.try_into()?;
    Ok(u64::from_le_bytes(raw))
}
