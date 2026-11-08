"""Rebuild Apple HomeView GLB with KeyShot textures properly bound and packed."""

from __future__ import annotations

import sys
from pathlib import Path

import bpy


ROOT = Path('/Users/ferreira/Downloads/mockup-studio')
FBX = ROOT / '.model-import/homeview/Apple HomeView.fbx'
TEX = ROOT / '.model-import/homeview/tex/Textures'
OUT = ROOT / 'public/models/apple_homeview.glb'


def load_image(path: Path):
    img = bpy.data.images.load(str(path), check_existing=True)
    img.pack()
    return img


def principled(mat: bpy.types.Material):
    mat.use_nodes = True
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        nodes.clear()
        bsdf = nodes.new('ShaderNodeBsdfPrincipled')
        out = nodes.new('ShaderNodeOutputMaterial')
        links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return bsdf, nt


def set_tex(mat, socket_name: str, image, *, non_color=False, label=''):
    bsdf, nt = principled(mat)
    nodes, links = nt.nodes, nt.links
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = image
    tex.label = label or socket_name
    if non_color and image:
        image.colorspace_settings.name = 'Non-Color'
    # Disconnect prior links on this socket
    for link in list(bsdf.inputs[socket_name].links):
        links.remove(link)
    links.new(tex.outputs['Color'], bsdf.inputs[socket_name])
    return tex


def clear_image_links(mat):
    if not mat.use_nodes:
        return
    for node in list(mat.node_tree.nodes):
        if node.type == 'TEX_IMAGE':
            mat.node_tree.nodes.remove(node)


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(FBX), use_image_search=True)

    images = {
        'grid_rough': load_image(TEX / 'Grid_Roughness.jpg'),
        'grid_normal': load_image(TEX / 'Grid_Normal.png'),
        'shell_rough': load_image(TEX / 'Shell_Roughness.jpg'),
        'noise': load_image(TEX / 'Nosie.jpg'),
        'cord_base': load_image(TEX / 'Power cord_Basecolor.jpg'),
        'cord_normal': load_image(TEX / 'Power cord_Normal.png'),
        'cord_rough': load_image(TEX / 'Power cord_Roughness.jpg'),
        'camera': load_image(TEX / 'Camera-Lens_Base.png'),
        'wallpaper': load_image(TEX / 'Wallpaper' / 'wallpaper01.jpg'),
    }

    for mat in bpy.data.materials:
        key = mat.name.lower()
        clear_image_links(mat)
        bsdf, _ = principled(mat)

        if key.startswith('grid'):
            # Roughness map was wrongly used as diffuse in the FBX — fix wiring.
            set_tex(mat, 'Base Color', images['noise'], label='grid_albedo')
            set_tex(mat, 'Roughness', images['grid_rough'], non_color=True, label='grid_rough')
            set_tex(mat, 'Normal', images['grid_normal'], non_color=True, label='grid_normal')
            # Normal socket expects Normal output — rebuild properly
            bsdf, nt = principled(mat)
            # replace Normal Color→Normal with Normal Map node
            for link in list(bsdf.inputs['Normal'].links):
                tex_node = link.from_node
                nt.links.remove(link)
                nmap = nt.nodes.new('ShaderNodeNormalMap')
                nt.links.new(tex_node.outputs['Color'], nmap.inputs['Color'])
                nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
            bsdf.inputs['Metallic'].default_value = 0.15
        elif key.startswith('shell'):
            set_tex(mat, 'Roughness', images['shell_rough'], non_color=True)
            bsdf.inputs['Base Color'].default_value = (0.08, 0.08, 0.09, 1)
            bsdf.inputs['Metallic'].default_value = 0.85
            bsdf.inputs['Roughness'].default_value = 0.45
        elif key.startswith('plug'):
            set_tex(mat, 'Base Color', images['cord_base'])
            set_tex(mat, 'Roughness', images['cord_rough'], non_color=True)
            # normal map node
            tex = set_tex(mat, 'Normal', images['cord_normal'], non_color=True)
            bsdf, nt = principled(mat)
            for link in list(bsdf.inputs['Normal'].links):
                src = link.from_node
                nt.links.remove(link)
                nmap = nt.nodes.new('ShaderNodeNormalMap')
                nt.links.new(src.outputs['Color'], nmap.inputs['Color'])
                nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
            bsdf.inputs['Metallic'].default_value = 0.05
        elif key.startswith('camera'):
            set_tex(mat, 'Base Color', images['camera'])
            bsdf.inputs['Metallic'].default_value = 0.9
            bsdf.inputs['Roughness'].default_value = 0.25
        elif key.startswith('screen'):
            # Placeholder — runtime screenshot replaces this.
            mat.name = 'screen'
            bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1)
            bsdf.inputs['Emission Color'].default_value = (0, 0, 0, 1)
            bsdf.inputs['Metallic'].default_value = 0
            bsdf.inputs['Roughness'].default_value = 1
        elif key.startswith('frame'):
            bsdf.inputs['Base Color'].default_value = (0.05, 0.05, 0.055, 1)
            bsdf.inputs['Metallic'].default_value = 0.95
            bsdf.inputs['Roughness'].default_value = 0.35
        elif key.startswith('speaker'):
            # Keep KeyShot tint; add subtle roughness variation.
            set_tex(mat, 'Roughness', images['shell_rough'], non_color=True)
            bsdf.inputs['Metallic'].default_value = 0.2
            if bsdf.inputs['Roughness'].default_value < 0.2:
                bsdf.inputs['Roughness'].default_value = 0.55

    OUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUT),
        export_format='GLB',
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_cameras=False,
        export_lights=False,
    )
    print(f'Wrote {OUT} ({OUT.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
