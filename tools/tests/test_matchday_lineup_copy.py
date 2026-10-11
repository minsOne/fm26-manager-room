import sys
from pathlib import Path
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import matchday_lineup_copy as writer

class MatchdayCopyTests(unittest.TestCase):
    def fixture(self):
        players = [dict(id=str(i), name=str(i)) for i in range(1, 21)]
        refs = {str(i): i for i in range(1, 21)}
        request = dict(formation='4-2-3-1', lineup=dict(zip(writer.SLOTS, map(str, range(1, 12)))), bench=list(map(str, range(12, 21))))
        return request, players, refs

    def test_slot_order_and_empty_tail(self):
        request, players, refs = self.fixture()
        values, rows = writer.selection(request, players, refs)
        self.assertEqual(values, list(range(1, 21)) + [0xffffffff] * 6)
        self.assertEqual(rows[7]['slot'], 'rw')
        self.assertEqual(rows[8]['slot'], 'am')

    def test_invalid_selection_rejected(self):
        for change in [lambda r: r.update(formation='4-3-3'), lambda r: r['bench'].pop(),
                       lambda r: r['bench'].__setitem__(0, '1'), lambda r: r['lineup'].update(gk='unknown')]:
            r, players, refs = self.fixture()
            change(r)
            with self.assertRaises(ValueError): writer.selection(r, players, refs)

    def test_unsupported_save_never_creates_file_or_runs_parser(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'source.fm'
            source.write_bytes(b'unsupported save')
            with self.assertRaises(ValueError): writer.run('create', source, '/missing/parser', {})
            self.assertEqual(list(Path(folder).iterdir()), [source])
            self.assertEqual(source.read_bytes(), b'unsupported save')

    def test_wrong_reference_record_rejected(self):
        with self.assertRaises(ValueError): writer.patch(bytes(writer.OFFSET + 104), writer.REFS)
