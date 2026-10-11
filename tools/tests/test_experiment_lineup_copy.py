import importlib.util
from pathlib import Path
import struct
import unittest

spec = importlib.util.spec_from_file_location(
    'experiment', Path(__file__).resolve().parents[1] / 'experiment_lineup_copy.py')
experiment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(experiment)


def string(value):
    data = value.encode()
    return struct.pack('<I', len(data)) + data


def selection():
    return b'prefix' + b'\x03' + string('test') + struct.pack('<26I', *range(1, 21), *([0xffffffff] * 6)) + b'suffix'


def save():
    tactics = experiment.compress(selection())
    other = experiment.compress(b'attributes and results remain identical')
    gap = b'opaque unlisted body'
    header = bytearray(experiment.MAGIC + b'\x08\x00\x00' + b'\x00' * 17)
    directory = string('synthetic') + struct.pack('<I', 1)
    directory += string('tactics_man') + string('.dat')
    directory += struct.pack('<5Q', 0, len(tactics), len(selection()), 77, 88)
    directory += struct.pack('<I', 1) + string('nested') + struct.pack('<I', 1)
    directory += string('game_db') + string('.dat')
    directory += struct.pack('<5Q', len(tactics) + len(gap), len(other), 38, 99, 111)
    directory += struct.pack('<I', 0)
    trailer = len(header) + len(tactics) + len(gap) + len(other)
    struct.pack_into('<Q', header, 9, trailer - 9)
    return bytes(header) + tactics + gap + other + experiment.MAGIC + b'\x08\x00\x00' + experiment.compress(directory)


class LineupCopyTests(unittest.TestCase):
    def test_nested_directory_and_unlisted_data_preserved(self):
        original = save()
        result, report = experiment.reconstruct(original, 'test', 0, 11)
        self.assertNotEqual(result, original)
        self.assertEqual(report['directoryEntriesVerified'], 2)
        self.assertTrue(report['allOtherCompressedEntriesIdentical'])
        self.assertTrue(report['unlistedBodyBytesIdentical'])
        self.assertFalse(report['gameLoadVerified'])
        self.assertFalse(report['liveSelectionApplied'])
        _, _, entries = experiment.unpack(result)
        entry = entries[0]
        data = experiment.decompress(result[entry['offset']:entry['offset'] + entry['size']])
        restored, _ = experiment.swap_named_references(data, 'test', 0, 11)
        self.assertEqual(restored, selection())

    def test_swap_roundtrip_changes_only_two_words(self):
        data = selection()
        patched, changes = experiment.swap_named_references(data, 'test', 0, 11)
        self.assertLessEqual(len(changes), 8)
        self.assertEqual(experiment.swap_named_references(patched, 'test', 0, 11)[0], data)

    def test_rejects_missing_and_duplicate_markers(self):
        for data, name in [(selection(), 'absent'), (selection() * 2, 'test')]:
            with self.assertRaises(ValueError):
                experiment.swap_named_references(data, name, 0, 11)

    def test_rejects_empty_duplicate_or_outside_slots(self):
        for first, second in [(-1, 2), (0, 20), (0, 0)]:
            with self.assertRaises(ValueError):
                experiment.swap_named_references(selection(), 'test', first, second)

    def test_rejects_changed_layout_or_truncation(self):
        for data in [selection()[:-20], selection().replace(struct.pack('<I', 20), struct.pack('<I', 19))]:
            with self.assertRaises(ValueError):
                experiment.swap_named_references(data, 'test', 0, 11)

    def test_rejects_unparsed_directory_suffix(self):
        _, payload, _ = experiment.unpack(save())
        with self.assertRaises(ValueError):
            experiment.directory_entries(payload + b'unknown')

    def test_rejects_bad_magic_or_trailer(self):
        for data in [b'not a save', experiment.MAGIC + b'\x00' * 20]:
            with self.assertRaises(ValueError):
                experiment.unpack(data)


if __name__ == '__main__':
    unittest.main()
