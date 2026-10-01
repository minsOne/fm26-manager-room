#!/usr/bin/env python3
import argparse
import json
import time
from pathlib import Path

from fmsave._container import read_index, read_section

parser=argparse.ArgumentParser()
parser.add_argument("save",type=Path)
parser.add_argument("--section",default="game_db")
args=parser.parse_args()

total=time.perf_counter()
started=time.perf_counter()
index=read_index(args.save)
index_ms=(time.perf_counter()-started)*1000

entry=index.sections[args.section]
started=time.perf_counter()
data=read_section(index,args.section)
decompress_ms=(time.perf_counter()-started)*1000

step=max(1,len(data)//4096)
checksum=0
for byte in data[::step]:
    checksum=((checksum*16777619)^byte)&0xFFFFFFFFFFFFFFFF

result={
  "file_bytes":index.fingerprint.file_size,
  "save_name":index.save_name,
  "directory_entries":len(index.entries),
  "sections":len(index.sections),
  "index_ms":index_ms,
  "section":{
    "name":args.section,
    "compressed_bytes":entry.compressed_size,
    "decompressed_bytes":len(data),
    "expected_decompressed_bytes":entry.decompressed_size,
    "decompress_ms":decompress_ms,
    "checksum_sample":checksum,
  },
  "total_ms":(time.perf_counter()-total)*1000,
}
print(json.dumps(result,indent=2))
