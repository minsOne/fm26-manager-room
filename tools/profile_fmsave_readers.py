#!/usr/bin/env python3
import argparse
import json
import time
from pathlib import Path

import fmsave

parser=argparse.ArgumentParser()
parser.add_argument("save",type=Path)
args=parser.parse_args()

def timed(name, fn):
    started=time.perf_counter()
    value=fn()
    elapsed=(time.perf_counter()-started)*1000
    rows=len(value) if hasattr(value,"__len__") else None
    result[name]={"ms":elapsed,"rows":rows}
    return value

result={}
total=time.perf_counter()
with fmsave.open(args.save) as save:
    result["open"]={"ms":(time.perf_counter()-total)*1000,"rows":None}
    managed=timed("managed_clubs",lambda:list(save.managed_clubs()))
    players=timed("players",lambda:list(save.players()))
    managed_uid=managed[0].club_uid if managed else None
    started=time.perf_counter()
    squad=[p for p in players if p.club_uid==managed_uid]
    result["managed_squad_filter"]={"ms":(time.perf_counter()-started)*1000,"rows":len(squad)}
    timed("clubs",lambda:list(save.clubs()))
    timed("finances",lambda:list(save.finances()))
    timed("fixtures",lambda:list(save.fixtures()))
    timed("player_match_stats",lambda:list(save.player_match_stats()))
    timed("training",lambda:list(save.training()))
    try:
        timed("tactics",lambda:list(save.tactics()))
    except Exception as exc:
        result["tactics"]={"ms":None,"rows":None,"error":type(exc).__name__}

result["total_ms"]=(time.perf_counter()-total)*1000
print(json.dumps(result,indent=2))
