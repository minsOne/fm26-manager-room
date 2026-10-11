import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'probe', Path(__file__).resolve().parents[1] / 'lineup_storage_probe.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class StorageProbeTests(unittest.TestCase):
    def test_content_changes_and_preserves_original(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'selection'
            source.write_bytes(b'first')
            before = probe.inventory([root])
            self.assertEqual(source.read_bytes(), b'first')
            source.write_bytes(b'other')  # same size, different content
            (root / 'new').write_bytes(b'new')
            after = probe.inventory([root])
            diff = probe.compare(before, after)
            self.assertEqual(diff['contentChanged'], [str(source)])
            self.assertEqual(diff['added'], [str(root / 'new')])
            self.assertFalse(diff['lineupFormatVerified'])
            self.assertFalse(diff['incomplete'])

    def test_self_link_and_external_link_are_not_followed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'self').symlink_to('self')
            (root / 'outside').symlink_to('/etc')
            report = probe.inventory([root])
            self.assertEqual(report['files'], {})
            self.assertEqual(len(report['links']), 2)
            self.assertEqual(report['errors'], [])

    def test_missing_root_is_reported(self):
        with tempfile.TemporaryDirectory() as folder:
            report = probe.inventory([Path(folder) / 'missing'])
            self.assertEqual(len(report['errors']), 1)
            self.assertTrue(probe.compare(report, report)['incomplete'])

    def test_unreadable_file_not_silently_omitted(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'data').write_bytes(b'data')
            with patch.object(probe.os, 'open', side_effect=PermissionError('denied')):
                report = probe.inventory([root])
            self.assertEqual(report['files'], {})
            self.assertIn('denied', report['errors'][0]['error'])

    def test_rejects_different_scopes(self):
        with self.assertRaises(ValueError):
            probe.compare({'schemaVersion': 1, 'roots': ['a']},
                          {'schemaVersion': 1, 'roots': ['b']})

    def test_modified_during_read_is_not_accepted(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'data').write_bytes(b'data')
            real_fstat = probe.os.fstat
            calls = []

            def changing(fd):
                info = real_fstat(fd)
                calls.append(fd)
                if len(calls) == 2:
                    (root / 'data').write_bytes(b'changed')
                    return real_fstat(fd)
                return info

            with patch.object(probe.os, 'fstat', side_effect=changing):
                report = probe.inventory([root])
            self.assertEqual(report['files'], {})
            self.assertIn('changed during', report['errors'][0]['error'])


if __name__ == '__main__':
    unittest.main()
