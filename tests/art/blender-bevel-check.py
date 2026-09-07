"""Focused Blender-side regression checks for exporter bevel handling."""

from __future__ import annotations

import importlib.util
import os
import sys


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
EXPORTER_PATH = os.path.join(ROOT, "tools", "blender", "export_hero_meshes.py")

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("export_hero_meshes", EXPORTER_PATH)
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)

exporter.clear_scene()
box = exporter.add_box("bevel_success", (1, 1, 1), (0, 0, 0))
vertices_before = len(box.data.vertices)
exporter.bevel(box, width=0.1, segments=2)
assert len(box.modifiers) == 0, "successful bevel modifier was not applied"
assert len(box.data.vertices) > vertices_before, "successful bevel did not change the mesh"


def fail_modifier_apply(*, modifier):
    raise ValueError(f"intentional modifier failure: {modifier}")


try:
    exporter.apply_modifier_or_raise(box, "BrokenBevel", fail_modifier_apply)
except RuntimeError as exc:
    assert "BrokenBevel" in str(exc), "failure omitted the modifier name"
    assert "bevel_success" in str(exc), "failure omitted the object name"
    assert isinstance(exc.__cause__, ValueError), "failure did not preserve its cause"
    assert "intentional modifier failure" in str(exc.__cause__)
else:
    raise AssertionError("modifier failure was silently ignored")

print("BLENDER_BEVEL_CHECK_OK")
