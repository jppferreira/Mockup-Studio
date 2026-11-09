"""Open a .blend and export a packed GLB (used by mokstudio Electron).

Usage:
  blender --background --python electron/blend-to-glb.py -- \\
    --input /path/model.blend --output /path/model.glb
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

    # Prefer packed textures so the GLB is self-contained when possible.
    try:
        bpy.ops.file.pack_all()
    except Exception:
        pass

    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format='GLB',
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_cameras=False,
        export_lights=True,
    )
    if not out.is_file() or out.stat().st_size < 12:
        raise SystemExit('Blender did not write a valid GLB')
    print(f'Wrote {out} ({out.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
