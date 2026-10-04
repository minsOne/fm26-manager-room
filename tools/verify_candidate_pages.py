#!/usr/bin/env python3
"""Independent external candidate page audit. Never print player/source values."""
import argparse
import json
import subprocess
from pathlib import Path
from verify_snapshot_fields import reference_player, compare_snapshots, REFERENCE_COMMIT

def main():
    cli=argparse.ArgumentParser()
    cli.add_argument('--save',type=Path,required=True);cli.add_argument('--parser',type=Path,required=True);cli.add_argument('--report',type=Path,required=True)
    args=cli.parse_args()
    if args.report.resolve() in (args.save.resolve(),args.parser.resolve()):cli.error('report must not replace input')
    try:
        import fmsave
        with fmsave.open(args.save) as career:
            clock=career.info.game_date;managed=list(career.managed_clubs())
            if clock is None or len(managed)!=1:raise ValueError('reference_identity')
            all_players=list(career.players());club=managed[0]
            external=sorted([p for p in all_players if p.club_uid!=club.club_uid],key=lambda p:(-p.ability.current,p.uid))
            if len(external)<200:raise ValueError('insufficient_external_fixture')
            checks=[]
            for query,offset in [('',0),('',100),(str(external[0].uid),0)]:
                matched=[p for p in external if not query or query in (p.name or '').lower() or query==str(p.uid)]
                page=matched[offset:offset+100]
                result=subprocess.run([str(args.parser),'candidates',str(args.save),query,str(offset)],capture_output=True,check=True,timeout=120)
                actual=json.loads(result.stdout)
                expected={'schemaVersion':2,'source':'rust-native','gameDate':clock.isoformat(),
                    'manager':{'clubUid':club.club_uid,'club':club.club_name},'players':[reference_player(p,clock) for p in page]}
                report=compare_snapshots(expected,{**actual,'players':actual.get('externalCandidates',[])})
                search=actual.get('candidateSearch',{})
                report['pageMetadataPassed']=search=={'scanned':len(all_players),'matched':len(matched),'offset':offset,'returned':len(page),'hasMore':offset+len(page)<len(matched)}
                report['passed']=report['passed'] and report['pageMetadataPassed'];checks.append(report)
            output={'passed':all(r['passed'] for r in checks),'referenceCommit':REFERENCE_COMMIT,'scope':'external_pages_reference_equivalence_only','pages':checks}
    except Exception as error:
        output={'passed':False,'reason':'candidate_audit_failed','errorType':type(error).__name__}
    args.report.write_text(json.dumps(output,indent=2)+'\n');print(json.dumps(output,indent=2))
    return 0 if output['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
