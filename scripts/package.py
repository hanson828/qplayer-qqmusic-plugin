#!/usr/bin/env python3
"""Build an unsigned QPlayer .qplug package for this plugin."""
import hashlib
import json
import pathlib
import shutil
import sys
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "plugin.json"


def main() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    plugin_id = str(manifest["id"])
    version = str(manifest["version"])

    with tempfile.TemporaryDirectory() as temp:
        stage = pathlib.Path(temp)
        shutil.copy2(MANIFEST, stage / "plugin.json")
        for name in ("src", "ui", "assets"):
            source = ROOT / name
            if source.is_dir():
                shutil.copytree(source, stage / name)

        files = {}
        for path in sorted(stage.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(stage).as_posix()
            if relative.startswith("META-INF/"):
                continue
            files[relative] = hashlib.sha256(path.read_bytes()).hexdigest()

        meta = stage / "META-INF"
        meta.mkdir(parents=True, exist_ok=True)
        (meta / "qplayer-files.json").write_text(
            json.dumps(files, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        output = ROOT / "dist" / f"{plugin_id}-{version}.qplug"
        output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(stage.rglob("*")):
                if not path.is_file():
                    continue
                relative = path.relative_to(stage).as_posix()
                info = zipfile.ZipInfo(relative, date_time=(2020, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                archive.writestr(info, path.read_bytes())

    print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
