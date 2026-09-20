"""Read-only ARM64 / 16 KiB ELF checks; no extraction, ADB, or installation."""
from pathlib import Path
import struct
import sys
import zipfile

apk = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "artifacts/TIEZ-Plus-0.1.0-arm64-v8a.apk"
with zipfile.ZipFile(apk) as archive:
    libraries = [name for name in archive.namelist() if name.startswith("lib/") and name.endswith(".so")]
    abis = sorted({name.split("/")[1] for name in libraries})
    if abis != ["arm64-v8a"]:
        raise SystemExit(f"Unexpected ABIs: {abis}")
    for name in libraries:
        data = archive.read(name)
        if data[:6] != b"\x7fELF\x02\x01" or struct.unpack_from("<H", data, 18)[0] != 183:
            raise SystemExit(f"Not an ARM64 ELF: {name}")
        offset = struct.unpack_from("<Q", data, 32)[0]
        size, count = struct.unpack_from("<HH", data, 54)
        for index in range(count):
            header = offset + index * size
            if struct.unpack_from("<I", data, header)[0] == 1:
                alignment = struct.unpack_from("<Q", data, header + 48)[0]
                if alignment < 16384:
                    raise SystemExit(f"LOAD segment alignment below 16 KiB: {name}")
    print(f"PASS: {len(libraries)} ARM64 ELF libraries; all LOAD segments aligned to >=16 KiB")
    print(f"Hermes asset: {archive.getinfo('assets/index.android.bundle').file_size} bytes")
