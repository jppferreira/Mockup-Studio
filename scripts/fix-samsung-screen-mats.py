"""Restore Samsung Flip/Fold GLBs and give screen meshes a dedicated Screen material.

Does not re-encode textures — only edits glTF JSON + remaps primitive material indices.
"""

from __future__ import annotations

import json
import shutil
import struct
from pathlib import Path

ROOT = Path('/Users/ferreira/Downloads/mockup-studio')
IMPORT = ROOT / '.model-import/samsung_fold_pack'
PUBLIC = ROOT / 'public/models'

# Original extracted names → public names, and which mesh node names are screens.
JOBS = [
    {
        'src': IMPORT / 'galaxy-z-flip-8/Samsung Galaxy Z Flip 8 Graphite.glb',
        'dst': PUBLIC / 'galaxy_z_flip8.glb',
        'screen_nodes': {'Screen'},
    },
    {
        'src': IMPORT / 'galaxy-z-fold-8/Samsung Galaxy Z Fold 8 Graphite.glb',
        'dst': PUBLIC / 'galaxy_z_fold8.glb',
        'screen_nodes': {'Screen_01', 'Screen_02'},
    },
    {
        'src': IMPORT
        / 'galaxy-z-fold-8-ultra/Samsung Galaxy Z Fold 8 Ultra Graphite.glb',
        'dst': PUBLIC / 'galaxy_z_fold8_ultra.glb',
        'screen_nodes': {'Screen_01', 'Screen_02'},
    },
]


def read_glb(path: Path):
    data = path.read_bytes()
    assert data[0:4] == b'glTF'
    json_len = struct.unpack_from('<I', data, 12)[0]
    json_start = 20
    json_end = json_start + json_len
    gltf = json.loads(data[json_start:json_end])
    pad = (4 - (json_len % 4)) % 4
    bin_hdr = json_end + pad
    bin_len = struct.unpack_from('<I', data, bin_hdr)[0]
    bin_data = data[bin_hdr + 8 : bin_hdr + 8 + bin_len]
    return gltf, bin_data


def write_glb(path: Path, gltf: dict, bin_data: bytes) -> None:
    json_bytes = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    json_pad = (4 - (len(json_bytes) % 4)) % 4
    json_bytes += b' ' * json_pad
    bin_pad = (4 - (len(bin_data) % 4)) % 4
    bin_bytes = bin_data + (b'\x00' * bin_pad)
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    out = bytearray()
    out += b'glTF'
    out += struct.pack('<II', 2, total)
    out += struct.pack('<I', len(json_bytes))
    out += b'JSON'
    out += json_bytes
    out += struct.pack('<I', len(bin_bytes))
    out += b'BIN\x00'
    out += bin_bytes
    path.write_bytes(out)


def mesh_node_names(gltf: dict) -> dict[int, set[str]]:
    """mesh index → set of node names referencing it."""
    mapping: dict[int, set[str]] = {}
    for node in gltf.get('nodes', []):
        if 'mesh' not in node:
            continue
        mapping.setdefault(node['mesh'], set()).add(node.get('name') or '')
    return mapping


def fix(job: dict) -> None:
    src: Path = job['src']
    dst: Path = job['dst']
    shutil.copy2(src, dst)
    gltf, bin_data = read_glb(dst)
    materials = gltf.setdefault('materials', [])

    # Dedicated untextured screen material for mockup content.
    screen_mat = {
        'name': 'Screen',
        'pbrMetallicRoughness': {
            'baseColorFactor': [0, 0, 0, 1],
            'metallicFactor': 0,
            'roughnessFactor': 1,
        },
    }
    screen_idx = len(materials)
    materials.append(screen_mat)

    node_names = mesh_node_names(gltf)
    screen_nodes: set[str] = job['screen_nodes']
    changed = 0

    # Only the display panels become the blank Screen material. Hinge / middle /
    # lens parts stay on Screen_Graphite — they share that atlas (normals, albedo).
    # Remapping them to Graphite left those meshes on the wrong UVs, so bumps
    # and body texture looked missing / flat white.
    for mesh_i, mesh in enumerate(gltf.get('meshes', [])):
        names = node_names.get(mesh_i, set())
        is_screen = bool(names & screen_nodes)
        if not is_screen:
            continue
        for prim in mesh.get('primitives', []):
            prim['material'] = screen_idx
            changed += 1

    write_glb(dst, gltf, bin_data)
    # verify images survived
    gltf2, _ = read_glb(dst)
    print(
        f'{dst.name}: screens={changed} images={len(gltf2.get("images", []))} '
        f'materials={[m.get("name") for m in gltf2.get("materials", [])]}'
    )


def main() -> None:
    for job in JOBS:
        if not job['src'].exists():
            print('missing', job['src'])
            continue
        fix(job)


if __name__ == '__main__':
    main()
