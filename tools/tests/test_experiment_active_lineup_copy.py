import sys
from pathlib import Path
import struct
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from experiment_active_lineup_copy import observed_swap


class ObservedSwapTests(unittest.TestCase):
    def setUp(self):
        self.refs = list(range(1, 21)) + [0xffffffff] * 6
        self.old = struct.pack('<26I', *self.refs)
        new = list(self.refs)
        new[0], new[11] = new[11], new[0]
        self.new = struct.pack('<26I', *new)

    def test_differential_disambiguates_saved_copy_of_same_lineup(self):
        before = b'prefix' + self.old + b'saved-copy' + self.old
        after = b'prefix' + self.new + b'saved-copy' + self.old
        offset, changes = observed_swap(before, after, self.refs, 0, 11)
        self.assertEqual(offset, 6)
        self.assertEqual(changes, [6, 50])

    def test_rejects_other_changes_in_tactics(self):
        with self.assertRaises(ValueError):
            observed_swap(self.old + b'a', self.new + b'b', self.refs, 0, 11)

    def test_rejects_both_copies_changed(self):
        with self.assertRaises(ValueError):
            observed_swap(self.old * 2, self.new * 2, self.refs, 0, 11)

    def test_rejects_no_change_wrong_slot_or_length(self):
        for after, first, second in [(self.old, 0, 11), (self.new, 1, 11),
                                     (self.new, 0, 20), (self.new[:-1], 0, 11)]:
            with self.assertRaises(ValueError):
                observed_swap(self.old, after, self.refs, first, second)


if __name__ == '__main__':
    unittest.main()
