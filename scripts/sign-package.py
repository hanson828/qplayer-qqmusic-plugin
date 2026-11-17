#!/usr/bin/env python3
"""Add a QPlayer publisher signature to an existing .qplug archive.

The private key is a P-256 PEM file kept outside the repository. The resulting
META-INF/qplayer.sig is the Base64 DER ECDSA/SHA-256 signature of the exact
META-INF/qplayer-files.json bytes, matching QPlayer's package format.
"""
import argparse
import base64
import pathlib
import subprocess
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SIGNER = ROOT / "scripts" / "ec-sign.js"
MANIFEST = "META-INF/qplayer-files.json"
SIGNATURE = "META-INF/qplayer.sig"


def main() -> int:
    parser = argparse.ArgumentParser(description="Sign a QPlayer .qplug package")
    parser.add_argument("archive", type=pathlib.Path)
    parser.add_argument("private_key", type=pathlib.Path)
    args = parser.parse_args()

    archive = args.archive.resolve()
    key = args.private_key.resolve()
    if not archive.is_file():
        raise SystemExit("archive not found: " + str(archive))
    if not key.is_file():
        raise SystemExit("private key not found: " + str(key))

    with zipfile.ZipFile(archive) as package:
        entries = {item.filename: package.read(item.filename) for item in package.infolist() if not item.is_dir()}
    if MANIFEST not in entries:
        raise SystemExit("missing " + MANIFEST)

    with tempfile.TemporaryDirectory() as temp:
        temp_dir = pathlib.Path(temp)
        manifest_file = temp_dir / "qplayer-files.json"
        signature_file = temp_dir / "qplayer.sig"
        manifest_file.write_bytes(entries[MANIFEST])

        subprocess.run(
            ["node", str(SIGNER), str(key), str(manifest_file), str(signature_file)],
            check=True,
        )
        signature = signature_file.read_text(encoding="ascii").strip()
        base64.b64decode(signature, validate=True)

        signed = temp_dir / "signed.qplug"
        with zipfile.ZipFile(signed, "w", zipfile.ZIP_DEFLATED) as package:
            for name, content in entries.items():
                if name == SIGNATURE:
                    continue
                info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                package.writestr(info, content)

            info = zipfile.ZipInfo(SIGNATURE, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            package.writestr(info, signature + "\n")

        archive.write_bytes(signed.read_bytes())

    print("signed", archive)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
