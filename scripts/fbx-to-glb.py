"""Convert FBX (or OBJ) + textures to a packed GLB via Blender.

Usage:
  blender --background --python scripts/fbx-to-glb.py -- \\
    --input /path/model.fbx --output /path/model.glb [--tex /path/textures]
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
    parser.add_argument('--tex', action='append', default=[])
    return parser.parse_args(argv)


def main() -> None:
    import bpy

    args = parse_args(sys.argv)
    src = Path(args.input).expanduser().resolve()
    out = Path(args.output).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)

    ext = src.suffix.lower()
    if ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=str(src), use_image_search=True)
    elif ext == '.obj':
        bpy.ops.wm.obj_import(filepath=str(src))
    elif ext in {'.glb', '.gltf'}:
        bpy.ops.import_scene.gltf(filepath=str(src))
    else:
        raise SystemExit(f'Unsupported input: {ext}')

    # Point relative texture searches at extra folders when present.
    for folder in args.tex:
        tex_dir = Path(folder).expanduser().resolve()
        if not tex_dir.is_dir():
            continue
        for image in bpy.data.images:
            if image.packed_file or not image.filepath:
                continue
            name = Path(bpy.path.abspath(image.filepath)).name
            candidate = tex_dir / name
            if candidate.exists():
                image.filepath = str(candidate)
                image.reload()

    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format='GLB',
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_cameras=False,
        export_lights=False,
    )
    print(f'Wrote {out} ({out.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
