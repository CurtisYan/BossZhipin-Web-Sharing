#!/usr/bin/env python3
"""Sync the current release ZIP into the browser's stable local directory."""
import json
from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'manifest.json').read_text())['version']
archive = root / 'dist' / f'boss-job-share-extension-v{version}.zip'
target = root / 'local-extension'
with ZipFile(archive) as package:
    for item in package.infolist():
        destination = (target / item.filename).resolve()
        if not destination.is_relative_to(target.resolve()):
            raise ValueError(f'Unsafe ZIP entry: {item.filename}')
    assert json.loads(package.read('manifest.json'))['version'] == version
    package.extractall(target)
    for item in package.infolist():
        if not item.is_dir():
            assert (target / item.filename).read_bytes() == package.read(item)
print(f'Local extension {version}: {target}')
