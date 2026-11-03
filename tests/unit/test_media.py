"""F11.8: photos, video and sound. Every parser is checked on a tiny file built here, and on junk."""

import io
import struct
import wave
from datetime import datetime
from random import Random

import pytest
from PIL import Image

from backend.ingest.media import (
    avi_info,
    clock,
    describe,
    image_info,
    isobmff_info,
    kind_of,
    mp3_info,
    ogg_info,
    probe,
    wav_info,
    webm_info,
)
from backend.security.files import FileRejected, validate_upload
from scripts.make_test_files import exif_bytes, mjpeg_avi, photo_jpeg_mov, silent_mp3

LIMIT = 50 * 1024 * 1024


def _wav(rate=8000, channels=2, seconds=1.5) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\0\0" * channels * int(rate * seconds))
    return buf.getvalue()


def _box(kind: bytes, *body: bytes) -> bytes:
    data = b"".join(body)
    return struct.pack(">I", 8 + len(data)) + kind + data


def _mp4(version: int = 0) -> bytes:
    """ftyp + moov(mvhd, video trak, sound trak) + an mdat written with a 64-bit size."""
    if version == 1:
        mvhd = _box(b"mvhd", struct.pack(">IQQIQ", 1 << 24, 0, 0, 1000, 42_500), b"\0" * 80)
    else:
        mvhd = _box(b"mvhd", struct.pack(">IIIII", 0, 0, 0, 90_000, 90_000 * 42), b"\0" * 80)
    tkhd = _box(b"tkhd", b"\0" * 76, struct.pack(">II", 1280 << 16, 720 << 16))
    vide = _box(b"trak", tkhd, _box(b"mdia", _box(b"hdlr", b"\0" * 8, b"vide", b"\0" * 12)))
    mdhd = _box(b"mdhd", b"\0" * 12, struct.pack(">II", 48_000, 0))
    soun = _box(b"trak", _box(b"tkhd", b"\0" * 84), _box(b"mdia", mdhd, _box(b"hdlr", b"\0" * 8, b"soun", b"\0" * 12)))
    mdat = struct.pack(">I4sQ", 1, b"mdat", 16 + 32) + b"\0" * 32
    return _box(b"ftyp", b"isom", b"\0\0\0\1", b"isom") + mdat + _box(b"moov", mvhd, vide, soun)


def _ebml(ident: int, body: bytes) -> bytes:
    raw = ident.to_bytes((ident.bit_length() + 7) // 8, "big")
    return raw + _size(len(body)) + body


def _size(n: int) -> bytes:
    return bytes([0x10]) + n.to_bytes(3, "big")  # a 4-byte EBML size


def _webm() -> bytes:
    header = _ebml(0x1A45DFA3, _ebml(0x4282, b"webm"))
    info = _ebml(0x1549A966, _ebml(0x2AD7B1, (1_000_000).to_bytes(3, "big")) + _ebml(0x4489, struct.pack(">d", 7250.0)))
    video = _ebml(0xE0, _ebml(0xB0, (640).to_bytes(2, "big")) + _ebml(0xBA, (360).to_bytes(2, "big")))
    tracks = _ebml(0x1654AE6B, _ebml(0xAE, video))
    cluster = _ebml(0x1F43B675, b"\0" * 20)
    segment = b"\x18\x53\x80\x67" + b"\x01\xff\xff\xff\xff\xff\xff\xff" + info + tracks + cluster  # unknown size
    return header + segment


def _ogg_page(granule: int, payload: bytes) -> bytes:
    return b"OggS\0\2" + struct.pack("<qIIIB", granule, 1, 0, 0, 1) + bytes([len(payload)]) + payload


def _ogg_vorbis(rate=44100, seconds=3.0) -> bytes:
    ident = b"\x01vorbis" + struct.pack("<IBI", 0, 2, rate) + b"\0" * 13
    return _ogg_page(0, ident) + _ogg_page(int(rate * seconds), b"\0" * 10)


def test_kinds():
    assert [kind_of(t) for t in ("image/png", "video/mp4", "audio/wav", "application/pdf", None)] == [
        "photo",
        "video",
        "audio",
        "document",
        "document",
    ]


def test_photo_size_date_and_camera():
    img = Image.new("RGB", (64, 48))
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif_bytes(datetime(2024, 5, 1, 10, 22), ("FictionCam", "FC-2 Site")))
    info = image_info(buf.getvalue())
    assert info == {
        "format": "jpeg",
        "width": 64,
        "height": 48,
        "taken": "2024-05-01T10:22:00",
        "camera": "FictionCam FC-2 Site",
    }
    plain = io.BytesIO()
    img.save(plain, "PNG")
    assert image_info(plain.getvalue()) == {"format": "png", "width": 64, "height": 48}
    with pytest.raises(FileRejected):
        image_info(b"\x89PNG\r\n\x1a\n" + b"junk" * 10)


def test_wav_pcm_and_compressed():
    assert wav_info(_wav()) == {"format": "wav", "duration_s": 1.5, "sample_rate": 8000, "channels": 2}
    # IMA ADPCM (format 0x11): `wave` refuses it, the RIFF header still gives the length.
    fmt = struct.pack("<HHIIHH", 0x11, 1, 8000, 4000, 256, 4)
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", 8000) + b"\0" * 8000
    adpcm = b"RIFF" + struct.pack("<I", len(body)) + body
    assert wav_info(adpcm) == {"format": "wav", "duration_s": 2.0, "sample_rate": 8000, "channels": 1}


def test_mp3_constant_bitrate_id3_and_xing():
    data = silent_mp3(4)
    info = mp3_info(data)
    assert info["sample_rate"] == 44100 and info["channels"] == 1 and info["duration_s"] == pytest.approx(4, abs=0.1)
    id3 = b"ID3\4\0\0" + bytes([0, 0, 0, 20]) + b"\0" * 20
    assert mp3_info(id3 + data)["duration_s"] == pytest.approx(info["duration_s"], abs=0.01)
    # A Xing header (VBR) says exactly how many frames there are: 1000 frames = 26.122 s.
    frame = bytearray(b"\xff\xfb\x90\xc0" + b"\0" * 413)
    frame[4 + 17 : 4 + 17 + 12] = b"Xing" + struct.pack(">II", 1, 1000)
    assert mp3_info(bytes(frame) + data)["duration_s"] == pytest.approx(1000 * 1152 / 44100, abs=0.001)


def test_mp4_and_mov_headers():
    for version, seconds in ((0, 42.0), (1, 42.5)):
        info = isobmff_info(_mp4(version), "mp4")
        assert info["duration_s"] == seconds
        assert (info["width"], info["height"]) == (1280, 720)
        assert info["has_video"] and info["has_audio"] and info["sample_rate"] == 48_000
    frames = [b"\xff\xd8" + bytes([i]) * 50 + b"\xff\xd9" for i in range(25)]
    mov = isobmff_info(photo_jpeg_mov(frames, 320, 240, 10, datetime(2024, 3, 9, 14, 5)), "mov")
    assert mov["duration_s"] == 2.5 and (mov["width"], mov["height"]) == (320, 240)
    assert mov["taken"] == "2024-03-09T14:05:00"


def test_avi_webm_ogg_headers():
    frames = [b"\xff\xd8" + b"x" * 30 + b"\xff\xd9"] * 30
    assert avi_info(mjpeg_avi(frames, 320, 240, 10)) == {
        "format": "avi",
        "duration_s": 3.0,
        "width": 320,
        "height": 240,
    }
    assert webm_info(_webm()) == {"format": "webm", "duration_s": 7.25, "width": 640, "height": 360}
    assert ogg_info(_ogg_vorbis()) == {
        "format": "ogg",
        "codec": "vorbis",
        "channels": 2,
        "sample_rate": 44100,
        "duration_s": 3.0,
    }


@pytest.mark.parametrize(
    "media_type", ["audio/wav", "audio/mpeg", "audio/ogg", "audio/mp4", "video/mp4", "video/quicktime", "video/webm",
                   "video/x-msvideo"],
)  # fmt: skip
def test_junk_never_raises(media_type):
    rng = Random(11)
    samples = [b"", b"\0" * 7, rng.randbytes(4096), _mp4()[:60], _webm()[:30], b"RIFF\xff\xff\xff\xffWAVEfmt "]
    samples += [bytes([0xFF, 0xFB]) + rng.randbytes(500), b"OggS\0" + rng.randbytes(40)]
    samples += [
        struct.pack(">I4s", 0xFFFFFFF0, b"moov") + rng.randbytes(64),
        struct.pack(">I4s", 1, b"moov") + b"\0" * 8,
    ]
    for data in samples:
        info = probe(data, media_type)
        assert info["kind"] in ("video", "audio")


def test_describe_and_clock():
    assert describe({"kind": "video", "duration_s": 42.4, "width": 1280, "height": 720}) == "Video · 0:42 · 1280×720"
    assert describe({"kind": "audio", "duration_s": 3725, "sample_rate": 44100, "channels": 2}).startswith(
        "Audio · 1:02:05 · 44.1 kHz stereo"
    )
    assert describe({"kind": "photo", "width": 4, "height": 3, "taken": "2024-01-02T03:04:05", "camera": "X"}) == (
        "Photo · 4×3 · taken 2024-01-02 · X"
    )
    assert clock(None) is None and clock(59.6) == "1:00"


def test_upload_gate_checks_bytes_not_names():
    ok = {
        "clip.mp4": _mp4(),
        "clip.mov": photo_jpeg_mov([b"\xff\xd8\xff\xd9"], 8, 8, 10, datetime(2024, 1, 1)),
        "song.m4a": _mp4(),
        "clip.webm": _webm(),
        "clip.avi": mjpeg_avi([b"\xff\xd8\xff\xd9"], 8, 8, 10),
        "memo.wav": _wav(),
        "memo.mp3": silent_mp3(1),
        "memo.ogg": _ogg_vorbis(),
    }
    want = {
        "clip.mp4": "video/mp4",
        "clip.mov": "video/quicktime",
        "song.m4a": "audio/mp4",
        "clip.webm": "video/webm",
        "clip.avi": "video/x-msvideo",
        "memo.wav": "audio/wav",
        "memo.mp3": "audio/mpeg",
        "memo.ogg": "audio/ogg",
    }
    for name, data in ok.items():
        assert validate_upload(name, data[:4096], len(data), LIMIT) == (name, want[name])
    refused = {
        "text.mp4": b"Project: Alpha, plain text\n",
        "sound.mp4": _wav(),
        "movie.wav": _mp4(),
        "clip.mp3": _mp4(),
        "program.mov": b"MZ\x90\x00\x03\x00\x00\x00" + bytes(range(256)) * 4,
        "riff.avi": b"RIFF\x10\0\0\0WEBPVP8 " + b"\0" * 20,
        "matroska.webm": b"\x1a\x45\xdf\xa3" + b"\0" * 10 + b"matroska",
        "clip": _mp4(),
    }
    for name, data in refused.items():
        with pytest.raises(FileRejected):
            validate_upload(name, data[:4096], len(data), LIMIT)
    # Ordinary text whose 5th to 8th letters spell an atom name stays text.
    assert validate_upload("note.txt", b"The free market note", 20, LIMIT) == ("note.txt", "text/plain")
    big = _mp4()
    with pytest.raises(FileRejected, match="exceeds limit"):
        validate_upload("big.mp4", big[:4096], LIMIT + 1, LIMIT)
