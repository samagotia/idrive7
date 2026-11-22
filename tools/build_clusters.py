#!/usr/bin/env python3
"""Build the standalone cluster app using its permanent release identity.

Run from the studio with python3 tools/build_clusters.py. The version comes
from apps/samagotia_clusters/app.json and branding from its release.json.
"""
import argparse
import atexit
import fcntl
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import shutil
import tarfile
import tempfile


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'apps' / 'samagotia_clusters'



def prune_runtime(javascript):
    """Keep only transitively required kit modules, plus their runtime data/licences.

    The kit builder stages the full kit. F8X needs its UI/signals/read-only diagnostic
    infrastructure, not the sample car decoder, simulator, engine guesses or games.
    Literal relative imports include the lazy fuel diagnostic imports in F8X.
    """
    relative_import = re.compile(r"require\(\s*['\"](\.[^'\"]+)['\"]\s*\)")
    seen = set()
    pending = list(javascript.glob('*.js'))
    while pending:
        file = pending.pop().resolve()
        if file in seen:
            continue
        seen.add(file)
        source = file.read_text()
        source = re.sub(r'/\*.*?\*/', '', source, flags=re.S)
        source = re.sub(r'^\s*//.*$', '', source, flags=re.M)
        for name in relative_import.findall(source):
            base = file.parent / name
            target = next((path for path in (base, Path(str(base) + '.js'), Path(str(base) + '.json'))
                           if path.is_file()), None)
            if target is None:
                raise SystemExit('Missing runtime dependency: ' + str(file) + ' -> ' + name)
            target = target.resolve()
            if not target.is_relative_to(javascript.resolve()):
                raise SystemExit('Runtime dependency leaves app: ' + name)
            if target.suffix == '.js':
                pending.append(target)
    for file in (javascript / 'kit').glob('*.js'):
        if file.resolve() not in seen:
            file.unlink()
    # i18n requires locale.json; mgu reads app-spec.json. Fonts dynamically load
    # the kit's six UI atlases, whose original licence files remain alongside.
    for directory in (javascript / 'kit').iterdir():
        if directory.is_dir() and directory.name != 'fonts':
            shutil.rmtree(directory)
    forbidden = {'hud.js', 'page.js', 'layouts.js', 'shaders.js', 'icons.js', 'hud_data.js',
                 'hud_text.js', 'car.js', 'sim.js', 'engine.js', 'shift_score.js', 'waze.js'}
    remaining = list(javascript.rglob('*.js'))
    if any(file.name in forbidden for file in remaining):
        raise SystemExit('Unused sample module remains in standalone app')
    allowed = {'app.js'} | set(json.loads((APP / 'app.json').read_text())['shared'])
    if {file.name for file in javascript.glob('*.js')} != allowed:
        raise SystemExit('Standalone module allowlist does not match staged files')
    return remaining

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=ROOT.parent)
    parser.add_argument('--stage-only', action='store_true', help='Stage the app for the local preview')
    parser.add_argument('--repo', help='GitHub owner/repository used for the catalog release')
    args = parser.parse_args()
    if args.stage_only:
        # The watcher and an explicit Mac rebuild may arrive together. The
        # SDK replaces this stage in place, so serialize those writers.
        lock_path = ROOT / 'dist' / '.samagotia-stage.lock'
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        stage_lock = lock_path.open('a')
        fcntl.flock(stage_lock.fileno(), fcntl.LOCK_EX)
        atexit.register(stage_lock.close)
    if args.repo and (len(args.repo.split('/')) != 2 or any(
            not part or any(char not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._' for char in part)
            for part in args.repo.split('/'))):
        parser.error('--repo must be a GitHub owner/repository')
    sdk = ROOT / 'oap-sdk'
    if not (sdk / 'index.js').exists():
        sdk.mkdir(exist_ok=True)
        (sdk / 'index.js').write_text("'use strict';\n// BENCH_STUB: local staging only; removed before packaging.\nthrow new Error('BENCH_STUB oap-sdk');\n")
        (sdk / 'package.json').write_text(json.dumps({'name': 'oap-sdk', 'version': '0.0.0-bench-stub', 'main': 'index.js'}) + '\n')
    release = json.loads((APP / 'release.json').read_text())
    spec = json.loads((APP / 'app.json').read_text())
    spec.update({key: value for key, value in release.items() if key not in ('layouts', 'visibleSettings', 'fonts')})
    # app.json is the permanent standalone source; release.json adds Store metadata.
    for screen in spec['screens']:
        if screen['name'] == 'MAIN':
            screen['title'] = release['title']

    module_spec = importlib.util.spec_from_file_location('cluster_build', ROOT / 'kit/tools/build.py')
    builder = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(builder)
    app_id = release['id']
    with tempfile.TemporaryDirectory(prefix='samagotia-build-') as temporary:
        apps = Path(temporary) / 'apps'
        source = apps / app_id
        shutil.copytree(APP, source)
        (source / 'app.json').write_text(json.dumps(spec, indent=2) + '\n')
        builder.APPS = str(apps)
        if not args.stage_only:
            builder.DIST = str(Path(temporary) / 'dist')
        stage = Path(builder.DIST) / app_id
        # Stage using the local SDK stub, then remove it before packaging.
        os.environ['M4_PREVIEW_ONLY'] = '1'
        builder.build(app_id)

        package = stage / 'source'
        shutil.rmtree(package / 'node_modules')
        retained = prune_runtime(package / 'javascript')
        print('  Retained runtime: ' + str(len(retained)) + ' JavaScript modules')
        shutil.copy(APP / 'LICENSE', package / 'javascript/LICENSE')
        package_json = package / 'package.json'
        metadata = json.loads(package_json.read_text())
        metadata['mguHmi'] = release['mguHmi']
        metadata['license'] = release['license']
        metadata['requires'] = release['requires']
        package_json.write_text(json.dumps(metadata, indent=2) + '\n')
        if args.stage_only:
            return
        output = args.out.resolve()
        output.mkdir(parents=True, exist_ok=True)
        archive = output / (app_id + '@' + spec['version'] + '.tgz')
        pending = archive.with_suffix('.tgz.tmp')
        with builder.gz_header_free(str(pending)) as compressed:
            with tarfile.open(fileobj=compressed, mode='w') as tar:
                tar.add(package, arcname='package')
        pending.replace(archive)
        store = {'apps': {app_id: {
            'title': release['title'], 'description': release['description'], 'author': release['vendor'],
        }}}
        (output / 'mgu-store.json').write_text(json.dumps(store, indent=2) + '\n')
        download = ('https://github.com/' + args.repo + '/releases/download/catalog/' + archive.name
                    if args.repo else archive.name)
        catalog = {'schema': 2, 'components': [{
            'id': app_id, 'kind': 'app', 'version': spec['version'],
            'title': release['title'], 'description': release['description'], 'author': release['vendor'],
            'mguHmi': release['mguHmi'], 'requires': release['requires'], 'uninstallable': True,
            'artifact': {'name': archive.name, 'size': archive.stat().st_size,
                         'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'url': download},
        }]}
        (output / 'catalog.json').write_text(json.dumps(catalog, indent=2) + '\n')
        print('Package: ' + str(archive))
        print('Store metadata: ' + str(output / 'mgu-store.json'))
        print('Dependency catalog: ' + str(output / 'catalog.json'))
        if not args.repo:
            print('The catalog uses a relative package URL for an HTTPS catalog source. '
                  'Use --repo OWNER/REPO to prepare the GitHub catalog release.')


if __name__ == '__main__':
    main()
