"""Verify an exact two-function overlay against the observed production module."""
from __future__ import annotations

import ast
import copy
import hashlib
import json
from pathlib import Path
from typing import Any
import urllib.parse

root = Path(__file__).resolve().parent / 'fixtures/ytdlp-recovery-20261125'
source = {key: (root / ('language_test_submitter.' + key + '.py')).read_text() for key in ('before', 'after')}
parsed = {key: ast.parse(value) for key, value in source.items()}
named = {key: {node.name: ast.dump(node, include_attributes=False) for node in value.body if isinstance(node, (ast.FunctionDef, ast.ClassDef))} for key, value in parsed.items()}
assert named['before'].keys() == named['after'].keys()
assert {key for key in named['before'] if named['before'][key] != named['after'][key]} == {'_contrast_editor_kind', '_contrast_sns_editor_compatible'}
base_other = [ast.dump(node, include_attributes=False) for node in parsed['before'].body if not isinstance(node, (ast.FunctionDef, ast.ClassDef))]
next_other = [ast.dump(node, include_attributes=False) for node in parsed['after'].body if not isinstance(node, (ast.FunctionDef, ast.ClassDef))]
assert base_other == next_other
fixture = json.loads((root / 'identities.json').read_text())
namespace = {'Any': Any, 'urllib': urllib}
for node in parsed['after'].body:
    if isinstance(node, ast.FunctionDef) and node.name in ('_contrast_editor_kind', '_contrast_sns_editor_compatible'):
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<reviewed-overlay>', 'exec'), namespace)
old_fn = next(n for n in parsed['before'].body if isinstance(n, ast.FunctionDef) and n.name == '_contrast_editor_kind')
old_identities = ast.literal_eval(old_fn.body[0].value)
for release_id, values in old_identities.items():
    assert namespace['_contrast_editor_kind']({'id': release_id, **values}) == values['kind']
checks = 0
for name, r in fixture['editors'].items():
    kind = name.removesuffix('_editor')
    release = {'id': r['id'], 'git_sha': r['source'], 'worker_image_digest': r['digest'], 'production_job_definition_arn': r['definition'], 'font_manifest_sha256': '1da578de91943f1299bb48e33649264dc748f89356879702817ceab38668beff', 'status': 'canary_ready', 'staging_verified_at': 'fixture', 'render_spec_version': 4, 'caption_render_spec_version': 4}
    assert namespace['_contrast_editor_kind'](release) == kind
    details = {'unifiedTemplateEditorVersion': 1, 'generationReleaseIds': [fixture['ids'][kind], fixture['old'][kind]], 'sourceGitSha': r['source'], 'imageDigest': r['digest'], 'fontManifestSha256': release['font_manifest_sha256']}
    details['unifiedSocialProbe'] = {**details, 'batchStatus': 'SUCCEEDED', 'runtimeIdentityVerified': True}
    response = [{'completed_at': 'fixture', 'details': details}]
    namespace['rest'] = lambda table, **kwargs: [{'id': 'user'}] if table == 'app_users' else response
    parent = {'user_id': 'user', 'language_test_release_id': fixture['ids'][kind], 'template_snapshot': {'snsTemplateVersion': 1, **({'communityTemplateVersion': 1} if kind == 'community' else {})}}
    compatible = namespace['_contrast_sns_editor_compatible']
    assert compatible(parent, release); checks += 1
    assert compatible({**parent, 'language_test_release_id': fixture['old'][kind]}, release); checks += 1
    for field in ('id', 'git_sha', 'worker_image_digest', 'production_job_definition_arn', 'font_manifest_sha256', 'status', 'render_spec_version'):
        assert not compatible(parent, {**release, field: 'wrong'}); checks += 1
    assert not compatible({**parent, 'language_test_release_id': fixture['ids']['language']}, release); checks += 1
    for field, value in [('batchStatus', 'FAILED'), ('runtimeIdentityVerified', False), ('imageDigest', 'wrong')]:
        original = copy.deepcopy(response)
        response[0]['details']['unifiedSocialProbe'][field] = value
        assert not compatible(parent, release); checks += 1
        response[:] = original
print(json.dumps({'passed': True, 'bindingChecks': checks, 'preservedOldIdentities': len(old_identities), 'overlaySha256': hashlib.sha256(source['after'].encode()).hexdigest()}))
