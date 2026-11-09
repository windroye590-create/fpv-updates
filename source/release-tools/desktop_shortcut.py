"""Package an explicit Windows shortcut icon without changing the executable."""
from pathlib import Path
import argparse
import hashlib
import io
import struct

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SIZES = (16, 32, 48, 64, 128, 256)


def prepare_assets(destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    artwork = (ROOT / 'web/icon.png').read_bytes()
    image = Image.open(io.BytesIO(artwork)).convert('RGBA')
    frames = []
    for size in SIZES:
        frame = image.resize((size, size), Image.Resampling.LANCZOS)
        if size == 256:
            output = io.BytesIO()
            frame.save(output, format='PNG')
            payload = output.getvalue()
        else:
            # Standard ICO DIB: bottom-up BGRA pixels followed by the AND mask.
            pixels = frame.transpose(Image.Transpose.FLIP_TOP_BOTTOM).tobytes('raw', 'BGRA')
            stride = ((size + 31) // 32) * 4
            mask = bytearray(stride * size)
            alpha = frame.getchannel('A')
            for y in range(size):
                for x in range(size):
                    if alpha.getpixel((x, y)) == 0:
                        mask[(size - 1 - y) * stride + x // 8] |= 1 << (7 - x % 8)
            payload = struct.pack('<IiiHHIIIIII', 40, size, size * 2, 1, 32, 0,
                                  len(pixels) + len(mask), 0, 0, 0, 0) + pixels + bytes(mask)
        frames.append((size, payload))
    offset = 6 + 16 * len(frames)
    directory = bytearray(struct.pack('<HHH', 0, 1, len(frames)))
    for size, payload in frames:
        directory.extend(struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0,
                                     1, 32, len(payload), offset))
        offset += len(payload)
    icon_name = 'FPV-Komisiia-Emblem-' + hashlib.sha256(artwork).hexdigest()[:12] + '.ico'
    icon = destination / icon_name
    icon.write_bytes(directory + b''.join(payload for _, payload in frames))
    template = (ROOT / 'release-tools/shortcut-template.cmd').read_text(encoding='utf-8')
    assert template.count('@ICON_FILE@') == 1
    command = destination / 'STVORYTY-YARLYK.cmd'
    command.write_bytes(template.replace('@ICON_FILE@', icon_name).replace('\r\n', '\n')
                        .replace('\n', '\r\n').encode('utf-8'))
    return icon, command


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    for item in prepare_assets(parser.parse_args().destination):
        print(item)
