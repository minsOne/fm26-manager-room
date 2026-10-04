import copy
import importlib.util
import json
import sys
import unittest
from dataclasses import make_dataclass
from datetime import date
from pathlib import Path
from types import SimpleNamespace as NS

path = Path(__file__).resolve().parents[1] / 'verify_snapshot_fields.py'
spec = importlib.util.spec_from_file_location('field_audit', path)
audit = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = audit
spec.loader.exec_module(audit)


def fixture():
    return {'schemaVersion': 2, 'source': 'rust-native', 'gameDate': '2037-07-01',
            'manager': {'clubUid': 77, 'club': 'Synthetic Club'},
            'players': [
                {'id':'101','name':'Synthetic One','ca':150,'pa':175,'paKnown':True,
                 'attributes': {'finishing':16,'passing':9}, 'hidden':{'consistency':12},
                 'fitness':{'fatigueKnown':False}, 'ageKnown':True,
                 'birthDate':'2010-06-30','positions':['ST'], 'positionRatings':{'STC':20,'GK':1}},
                {'id':'102','name':'Synthetic Two','ca':120,'pa':180,'paKnown':True,
                 'attributes': {'finishing':8,'passing':17}, 'hidden':{'consistency':16},
                 'fitness':{'fatigueKnown':False}, 'ageKnown':True,
                 'birthDate':'2011-09-20','positions':['CM'], 'positionRatings':{'STC':1,'GK':1}},
            ]}


class FieldAuditTests(unittest.TestCase):
    def test_identical(self):
        s=fixture(); report=audit.compare_snapshots(s, copy.deepcopy(s))
        self.assertTrue(report['passed']); self.assertEqual(report['comparedPlayers'],2)
        self.assertGreater(report['fieldChecks'],25)

    def test_player_order_irrelevant(self):
        s=fixture(); changed=copy.deepcopy(s); changed['players'].reverse()
        self.assertTrue(audit.compare_snapshots(s,changed)['passed'])

    def test_swapped_players_preserve_sum_but_fail(self):
        s=fixture(); changed=copy.deepcopy(s)
        changed['players'][0]['ca'],changed['players'][1]['ca']=120,150
        self.assertEqual(sum(p['ca'] for p in s['players']),sum(p['ca'] for p in changed['players']))
        self.assertEqual(audit.compare_snapshots(s,changed)['mismatches'],2)

    def test_swapped_names_preserve_byte_count_but_fail(self):
        s=fixture(); changed=copy.deepcopy(s)
        changed['players'][0]['name'],changed['players'][1]['name']=changed['players'][1]['name'],changed['players'][0]['name']
        self.assertFalse(audit.compare_snapshots(s,changed)['passed'])

    def test_swapped_attribute_names_preserve_sum_but_fail(self):
        s=fixture(); changed=copy.deepcopy(s)
        changed['players'][0]['attributes']={'finishing':9,'passing':16}
        self.assertFalse(audit.compare_snapshots(s,changed)['passed'])

    def test_duplicate_ids_fail(self):
        s=fixture(); changed=copy.deepcopy(s); changed['players'].append(changed['players'][0])
        self.assertFalse(audit.compare_snapshots(s,changed)['passed'])

    def test_missing_player_fails(self):
        s=fixture(); changed=copy.deepcopy(s); changed['players'].pop()
        self.assertFalse(audit.compare_snapshots(s,changed)['passed'])

    def test_extra_player_fails(self):
        s=fixture(); changed=copy.deepcopy(s); changed['players'].append({'id':'999'})
        self.assertFalse(audit.compare_snapshots(s,changed)['passed'])

    def test_wrong_hidden_field_fails(self):
        s=fixture(); changed=copy.deepcopy(s); changed['players'][0]['hidden']['consistency']=11
        self.assertFalse(audit.compare_snapshots(s,changed)['passed'])

    def test_unknown_cannot_become_known(self):
        s=fixture(); changed=copy.deepcopy(s); changed['players'][0]['fitness']['fatigueKnown']=True
        self.assertFalse(audit.compare_snapshots(s,changed)['passed'])

    def test_unknown_pa_flag_not_just_number(self):
        s=fixture(); changed=copy.deepcopy(s); changed['players'][0]['paKnown']=False
        self.assertFalse(audit.compare_snapshots(s,changed)['passed'])

    def test_bool_is_not_numeric(self):
        s=fixture(); s['players'][0]['ca']=1; changed=copy.deepcopy(s); changed['players'][0]['ca']=True
        self.assertFalse(audit.compare_snapshots(s,changed)['passed'])

    def test_integer_is_not_bool(self):
        s=fixture(); changed=copy.deepcopy(s); changed['players'][0]['fitness']['fatigueKnown']=0
        self.assertFalse(audit.compare_snapshots(s,changed)['passed'])

    def test_missing_none_field_not_equal_to_none(self):
        s=fixture(); s['players'][0]['paRangeCode']=None; changed=copy.deepcopy(s); del changed['players'][0]['paRangeCode']
        self.assertFalse(audit.compare_snapshots(s,changed)['passed'])

    def test_extra_attribute_not_silently_accepted(self):
        s=fixture(); changed=copy.deepcopy(s); changed['players'][0]['attributes']['wrongField']=10
        self.assertFalse(audit.compare_snapshots(s,changed)['passed'])

    def test_same_sum_positions_swapped(self):
        s=fixture(); changed=copy.deepcopy(s); changed['players'][0]['positionRatings']={'STC':1,'GK':20}
        self.assertFalse(audit.compare_snapshots(s,changed)['passed'])

    def test_empty_not_vacuous_pass(self):
        s=fixture(); s['players']=[]
        self.assertFalse(audit.compare_snapshots(s,s)['passed'])

    def test_non_object(self):
        self.assertFalse(audit.compare_snapshots(fixture(),[])['passed'])

    def test_invalid_ids(self):
        for value in [None,True,2,'01','0','4294967295','+101','１０１']:
            with self.subTest(value=value):
                s=fixture(); changed=copy.deepcopy(s); changed['players'][0]['id']=value
                self.assertFalse(audit.compare_snapshots(s,changed)['passed'])

    def test_dates_full_months(self):
        self.assertEqual(audit.full_months(date(2037,1,31),date(2037,2,28)),0)
        self.assertEqual(audit.full_months(date(2037,1,31),date(2037,3,31)),2)
        self.assertEqual(audit.full_months(date(2037,1,31),date(2036,3,31)),0)

    def test_report_has_no_player_names_values_or_paths(self):
        s=fixture(); changed=copy.deepcopy(s); changed['players'][0]['name']='PRIVATE SAMPLE'
        report=audit.compare_snapshots(s,changed); encoded=json.dumps(report)
        self.assertNotIn('PRIVATE SAMPLE',encoded); self.assertNotIn('Synthetic One',encoded)
        self.assertTrue(report['examples'][0]['field']=='name')

    def test_example_budget(self):
        s=fixture(); changed=copy.deepcopy(s)
        for i in range(100): changed['players'].append({'id':str(1000+i)})
        report=audit.compare_snapshots(s,changed)
        self.assertEqual(len(report['examples']),20); self.assertEqual(report['mismatches'],100)

    def test_named_reference_adapter_without_fmsave_dependency(self):
        Attributes=make_dataclass('Attributes',[(x,int) for x in ['first_touch','finishing',*audit.HIDDEN_NAMES]])
        Positions=make_dataclass('Positions',[('gk',int),('stc',int)])
        player=NS(uid=101,name='Synthetic',age=37,birth_date=date(2000,3,1),nation_id=1,
                  attributes=Attributes(13,17,8,9,10,11,12),positions=Positions(1,20),
                  personality=None,contract=None,ability=NS(current=150,potential=None,potential_range_code=-8),
                  transfer_value=None,raw_condition=9850,raw_match_sharpness=0,
                  raw_left_foot=100,raw_right_foot=50,left_foot=20,right_foot=10)
        p=audit.reference_player(player,date(2037,3,1))
        self.assertEqual(p['attributes']['firstTouch'],13)
        self.assertEqual(p['hidden']['injuryProneness'],11)
        self.assertEqual(p['fitness']['condition'],99)
        self.assertFalse(p['wageKnown']); self.assertFalse(p['paKnown'])
        self.assertEqual(p['paRangeCode'],-8); self.assertEqual(p['positions'],['ST'])


    def test_dated_history_named_reference_preserves_unknowns_order_and_future_exclusion(self):
        row=lambda day,minutes: NS(player_uid=101,date=date(2037,7,day),opponent_team_id=77,
            competition_id=12,minutes=minutes,has_stats=minutes is not None)
        history=audit.reference_match_history([row(3,90),row(1,None),row(2,0)],date(2037,7,2))[101]
        self.assertEqual([r['date'] for r in history['matches']],['2037-07-02','2037-07-01'])
        self.assertEqual(history['matches'][0]['minutes'],0)
        self.assertIsNone(history['matches'][1]['minutes'])
        self.assertFalse(history['matches'][1]['minutesKnown'])
        self.assertFalse(history['historyComplete']);self.assertFalse(history['minutesInterpretationVerified'])
        self.assertFalse(audit.empty_match_history()['matchesKnown'])

    def test_dated_record_fields_are_audited_individually_without_raw_data_in_report(self):
        s=fixture();s['players'][0]['playingTime']={'matches':[{'date':'2037-07-01',
            'opponentTeamId':77,'competitionId':12,'minutes':0,'minutesKnown':True}]}
        for field,value in [('date','2037-07-02'),('opponentTeamId',88),('competitionId',13),('minutes',90),('minutesKnown',1)]:
            changed=copy.deepcopy(s);changed['players'][0]['playingTime']['matches'][0][field]=value
            report=audit.compare_snapshots(s,changed)
            self.assertFalse(report['passed']);self.assertEqual(report['mismatches'],1)
            self.assertEqual(report['examples'][0]['field'],'playingTime.matches.0.'+field)
            self.assertNotIn('2037-07-01',json.dumps(report))
        changed=copy.deepcopy(s);changed['players'][0]['playingTime']['matches']=[]
        self.assertFalse(audit.compare_snapshots(s,changed)['passed'])


if __name__ == '__main__': unittest.main()
