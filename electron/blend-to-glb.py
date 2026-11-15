"""Open a .blend and export a packed GLB (used by mokstudio Electron).

Usage:
  blender --background --python electron/blend-to-glb.py -- \\
    --input /path/model.blend --output /path/model.glb

Sidecar textures may sit next to the .blend (or in subfolders). We resolve
missing files from that folder, pack images into the .blend, then export a
self-contained GLB so composition materials survive the drop.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def parse_args(argv: list[str]) -> argparse.Namespace:
    if '--' in argv:
        argv = argv[argv.index('--') + 1 :]
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    return parser.parse_args(argv)


def pack_materials(src: Path) -> None:
    import bpy

    search_dirs = [str(src.parent)]
    # Also search one level of subfolders (common //textures layout).
    try:
        for child in src.parent.iterdir():
            if child.is_dir():
                search_dirs.append(str(child))
    except OSError:
        pass

    for directory in search_dirs:
        try:
            bpy.ops.file.find_missing_files(directory=directory)
        except Exception:
            pass

    try:
        bpy.ops.file.pack_all()
    except Exception:
        pass

    # Force images that still point at disk to load so glTF can embed them.
    for image in bpy.data.images:
        try:
            if image.packed_file:
                continue
            if image.filepath:
                image.reload()
            if not image.packed_file and image.filepath:
                image.pack()
        except Exception:
            pass


def export_glb(out: Path) -> None:
    import bpy

    # Core flags every recent Blender glTF exporter accepts.
    kwargs = {
        'filepath': str(out),
        'export_format': 'GLB',
        'export_apply': True,
        'export_texcoords': True,
        'export_normals': True,
        'export_materials': 'EXPORT',
        'export_image_format': 'AUTO',
        'export_cameras': False,
        'export_lights': True,
        'export_yup': True,
        'use_selection': False,
        'export_extras': True,
    }
    # Prefer the richest export when the installed Blender supports it.
    for extra in (
        {'export_tangents': True, 'export_colors': True, 'export_attributes': True},
        {'export_tangents': True, 'export_colors': True},
        {'export_tangents': True},
        {},
    ):
        try:
            bpy.ops.export_scene.gltf(**{**kwargs, **extra})
            return
        except TypeError:
            continue
    raise SystemExit('Blender glTF export failed')


def main() -> None:
    import bpy

    args = parse_args(sys.argv)
    src = Path(args.input).expanduser().resolve()
    out = Path(args.output).expanduser().resolve()
    if not src.is_file():
        raise SystemExit(f'Missing input: {src}')
    if src.suffix.lower() != '.blend':
        raise SystemExit(f'Expected a .blend file, got {src.suffix}')
    out.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.open_mainfile(filepath=str(src))
    pack_materials(src)
    export_glb(out)

    if not out.is_file() or out.stat().st_size < 12:
        raise SystemExit('Blender did not write a valid GLB')
    print(f'Wrote {out} ({out.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
