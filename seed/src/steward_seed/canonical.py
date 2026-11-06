"""Platform-independent content of generated files.

The seed is deterministic, but compressed bytes are not portable: Python and Pillow use
zlib-ng on Windows and the system zlib on Linux, so the same pixels compress to different
PNG and PDF bytes. Checks and the seed report therefore compare content: decoded pixels for
images, decompressed streams (without lengths and byte offsets) for PDFs, raw bytes for
everything else.
"""

from __future__ import annotations

import base64
import hashlib
import io
import re
import zlib

from PIL import Image

_STREAM = re.compile(rb"stream\r?\n(.*?)\r?\nendstream", re.S)
_FILTERS = re.compile(rb"/(ASCII85Decode|FlateDecode)")


def _decode_stream(head: bytes, body: bytes) -> bytes:
    # The stream's dictionary ends right before `stream`; its /Filter lists the decoders in order.
    dict_start = head.rfind(b"<<")
    filters = _FILTERS.findall(head[dict_start:]) if dict_start >= 0 else []
    data = body
    try:
        for f in filters:
            if f == b"ASCII85Decode":
                data = data.strip()
                data = data[2:] if data.startswith(b"<~") else data
                data = data[:-2] if data.endswith(b"~>") else data
                data = base64.a85decode(data)
            else:
                data = zlib.decompress(data)
    except (ValueError, zlib.error):
        return body
    return data


def _pdf(content: bytes) -> bytes:
    out = []
    pos = 0
    for m in _STREAM.finditer(content):
        head = content[pos : m.start()]
        out.append(re.sub(rb"/Length \d+", b"", head))
        out.append(b"stream\n" + _decode_stream(content[max(0, m.start() - 600) : m.start()], m.group(1)) + b"\nendstream")
        pos = m.end()
    tail = content[pos:]
    # The cross-reference table holds byte offsets, which follow the compressed sizes.
    tail = re.sub(rb"xref\r?\n.*?(?=trailer)", b"", tail, flags=re.S)
    tail = re.sub(rb"startxref\r?\n\d+", b"startxref", tail)
    out.append(tail)
    return b"".join(out)


def content(name: str, data: bytes) -> bytes:
    """What a generated file means, independent of the zlib it was compressed with."""
    if name.endswith(".png"):
        img = Image.open(io.BytesIO(data))
        return f"{img.mode} {img.size[0]}x{img.size[1]}\n".encode() + img.tobytes()
    if name.endswith(".pdf"):
        return _pdf(data)
    return data


def digest(name: str, data: bytes) -> str:
    return hashlib.sha256(content(name, data)).hexdigest()
