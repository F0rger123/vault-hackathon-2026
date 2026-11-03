"""Photos, video and sound (F11.8): what kind of file it is, and the details VAULT can read without looking inside.

VAULT never watches, listens to or looks at these files, and never sends them to a model. It reads only the
container's own header fields: size in pixels, length, sample rate, channels, and for photos the date taken and
camera model from EXIF. Every parser here works on bytes already in memory, uses only the standard library and
Pillow, bounds every loop, and returns an empty result rather than raising on a malformed file: a file whose
details cannot be read is still stored, just with fewer details.
"""

from __future__ import annotations

import io
import re
import struct
import wave
from datetime import UTC, datetime

from PIL import Image

from backend.security.files import FileRejected

KINDS = ("document", "photo", "video", "audio")
PLURAL = {"document": "documents", "photo": "photos", "video": "videos", "audio": "audio files"}
LABEL = {"document": "Document", "photo": "Photo", "video": "Video", "audio": "Audio"}
# SQL for "this row is a photo, video or sound file". Every such media type starts with one of these six letters.
MEDIA_SQL = "substr({col}, 1, 6) IN ('image/', 'video/', 'audio/')"
NOT_READ_NOTE = "Photos, video and sound are found by name, date and details, not by what is in them."
_MAX_BOXES = 4096  # a real MP4 has a few dozen boxes; anything past this is not worth walking


def kind_of(media_type: str | None) -> str:
    head = (media_type or "")[:6]
    return {"image/": "photo", "video/": "video", "audio/": "audio"}.get(head, "document")


def kind_sql(col: str = "d.media_type") -> str:
    return (
        f"CASE substr({col}, 1, 6) WHEN 'image/' THEN 'photo' WHEN 'video/' THEN 'video' "
        f"WHEN 'audio/' THEN 'audio' ELSE 'document' END"
    )


def is_media(media_type: str | None) -> bool:
    return kind_of(media_type) != "document"


# ---------- photos ----------

_EXIF_DATE = re.compile(r"^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})")


def _exif_date(value: object) -> str | None:
    m = _EXIF_DATE.match(str(value or "").strip())
    if not m:
        return None
    try:
        return datetime(*map(int, m.groups())).isoformat()  # also rejects month 13 and similar
    except ValueError:
        return None


def _clean(value: object, limit: int = 60) -> str | None:
    text = re.sub(r"[^\w .,()/+-]", "", str(value or "")).strip()
    return text[:limit] or None


def image_info(data: bytes) -> dict:
    """Width, height, and EXIF date taken and camera, if present. Raises FileRejected if it is not a real image."""
    try:
        with Image.open(io.BytesIO(data)) as img:
            img.verify()
        with Image.open(io.BytesIO(data)) as img:
            w, h = img.size
            fmt = (img.format or "").lower()
            try:
                exif = img.getexif()
                sub = exif.get_ifd(0x8769)  # the Exif sub-IFD holds DateTimeOriginal
                taken = _exif_date(sub.get(0x9003)) or _exif_date(exif.get(0x0132))
                make, model = _clean(exif.get(0x010F)), _clean(exif.get(0x0110))
            except Exception:  # noqa: BLE001 - a broken EXIF block only means fewer details
                taken = make = model = None
    except Exception as exc:
        raise FileRejected("image could not be decoded") from exc
    info: dict = {"format": fmt or None, "width": w, "height": h}
    if taken:
        info["taken"] = taken
    if model or make:
        info["camera"] = (
            model
            if (model and make and make.casefold() in model.casefold())
            else " ".join(x for x in (make, model) if x)
        )
    return info


# ---------- WAV ----------


def _riff_chunks(data: bytes, start: int, end: int):
    pos, n = start, 0
    while pos + 8 <= end and n < _MAX_BOXES:
        fourcc, size = data[pos : pos + 4], struct.unpack_from("<I", data, pos + 4)[0]
        yield fourcc, pos + 8, min(pos + 8 + size, end)
        pos += 8 + size + (size & 1)
        n += 1


def wav_info(data: bytes) -> dict:
    try:
        with wave.open(io.BytesIO(data), "rb") as w:
            rate, frames, channels = w.getframerate(), w.getnframes(), w.getnchannels()
        if rate > 0:
            return {"format": "wav", "duration_s": round(frames / rate, 3), "sample_rate": rate, "channels": channels}
    except (wave.Error, EOFError, struct.error, ValueError):
        pass
    # Compressed WAV (ADPCM and others) is not something `wave` opens; the header still gives the length.
    info: dict = {"format": "wav"}
    byte_rate = 0
    for fourcc, s, e in _riff_chunks(data, 12, len(data)):
        if fourcc == b"fmt " and e - s >= 16:
            _, channels, rate, byte_rate = struct.unpack_from("<HHII", data, s)
            info.update(sample_rate=rate, channels=channels)
        elif fourcc == b"data" and byte_rate:
            info["duration_s"] = round((e - s) / byte_rate, 3)
    return info


# ---------- MP3 ----------

_MP3_BITRATES = {  # kbit/s, Layer III only (index 1..14)
    1: (32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320),
    2: (8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160),
}
_MP3_RATES = {3: (44100, 48000, 32000), 2: (22050, 24000, 16000), 0: (11025, 12000, 8000)}


def _mp3_header(data: bytes, pos: int) -> dict | None:
    if pos + 4 > len(data):
        return None
    b1, b2, b3 = data[pos + 1], data[pos + 2], data[pos + 3]
    if data[pos] != 0xFF or (b1 & 0xE0) != 0xE0:
        return None
    version, layer = (b1 >> 3) & 3, (b1 >> 1) & 3  # version 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5; layer 1 = III
    br_index, rate_index = b2 >> 4, (b2 >> 2) & 3
    if version == 1 or layer != 1 or br_index in (0, 15) or rate_index == 3:
        return None
    rate = _MP3_RATES[version][rate_index]
    bitrate = _MP3_BITRATES[1 if version == 3 else 2][br_index - 1] * 1000
    samples = 1152 if version == 3 else 576
    length = samples // 8 * bitrate // rate + ((b2 >> 1) & 1)
    return {
        "version": version,
        "rate": rate,
        "bitrate": bitrate,
        "samples": samples,
        "length": length,
        "channels": 1 if (b3 >> 6) == 3 else 2,
    }


def mp3_info(data: bytes) -> dict:
    info: dict = {"format": "mp3"}
    pos = 0
    if data[:3] == b"ID3" and len(data) >= 10:
        size = (data[6] & 0x7F) << 21 | (data[7] & 0x7F) << 14 | (data[8] & 0x7F) << 7 | (data[9] & 0x7F)
        pos = 10 + size + (10 if data[5] & 0x10 else 0)
    end = len(data) - (128 if data[-128:-125] == b"TAG" else 0)
    limit = min(end, pos + 64 * 1024)  # the first frame sits near the start; do not scan the whole file
    while pos < limit:
        head = _mp3_header(data, pos)
        # A real frame is followed by another one; checking that skips stray 0xFF bytes in junk before the audio.
        if head and (pos + head["length"] >= end or _mp3_header(data, pos + head["length"])):
            break
        pos += 1
    else:
        return info
    info.update(sample_rate=head["rate"], channels=head["channels"], bitrate=head["bitrate"])
    # A Xing or Info header in the first frame says exactly how many frames there are (variable bitrate files).
    side = (17 if head["channels"] == 1 else 32) if head["version"] == 3 else (9 if head["channels"] == 1 else 17)
    tag = pos + 4 + side
    if data[tag : tag + 4] in (b"Xing", b"Info") and len(data) >= tag + 12:
        flags = struct.unpack_from(">I", data, tag + 4)[0]
        if flags & 1:
            frames = struct.unpack_from(">I", data, tag + 8)[0]
            info["duration_s"] = round(frames * head["samples"] / head["rate"], 3)
            return info
    info["duration_s"] = round((end - pos) * 8 / head["bitrate"], 3)
    return info


# ---------- MP4, MOV, M4A (ISO base media) ----------


def _boxes(data: bytes, start: int, end: int):
    pos, n = start, 0
    while pos + 8 <= end and n < _MAX_BOXES:
        size, kind = struct.unpack_from(">I4s", data, pos)
        head = 8
        if size == 1:
            if pos + 16 > end:
                return
            size, head = struct.unpack_from(">Q", data, pos + 8)[0], 16
        elif size == 0:
            size = end - pos
        if size < head:
            return
        yield kind, pos + head, min(pos + size, end)
        pos += size
        n += 1


def _child(data: bytes, start: int, end: int, kind: bytes) -> tuple[int, int] | None:
    for k, s, e in _boxes(data, start, end):
        if k == kind:
            return s, e
    return None


_MAC_EPOCH = 2_082_844_800  # seconds from 1904-01-01 (QuickTime's clock) to 1970-01-01


def isobmff_info(data: bytes, fmt: str) -> dict:
    info: dict = {"format": fmt}
    moov = _child(data, 0, len(data), b"moov")
    if not moov:
        return info
    mvhd = _child(data, *moov, b"mvhd")
    if mvhd:
        s, e = mvhd
        version = data[s] if s < e else 0
        if version == 1 and e - s >= 32:
            created, _, scale, duration = struct.unpack_from(">QQIQ", data, s + 4)
        elif e - s >= 20:
            created, _, scale, duration = struct.unpack_from(">IIII", data, s + 4)
        else:
            scale = duration = created = 0
        if scale:
            info["duration_s"] = round(duration / scale, 3)
        # Many cameras write the recording time here; 0 or a nonsense year means "not set".
        if created > _MAC_EPOCH:
            when = datetime.fromtimestamp(created - _MAC_EPOCH, UTC)
            if 1990 <= when.year <= 2100:
                info["taken"] = when.replace(tzinfo=None).isoformat()
    has_video = has_audio = False
    for kind, s, e in _boxes(data, *moov):
        if kind != b"trak":
            continue
        handler = None
        mdia = _child(data, s, e, b"mdia")
        if mdia and (hdlr := _child(data, *mdia, b"hdlr")) and hdlr[1] - hdlr[0] >= 12:
            handler = data[hdlr[0] + 8 : hdlr[0] + 12]
        has_video |= handler == b"vide"
        has_audio |= handler == b"soun"
        tkhd = _child(data, s, e, b"tkhd")
        if handler == b"vide" and tkhd:
            ts, te = tkhd
            offset = ts + (88 if data[ts] == 1 else 76)  # width and height are the last two 16.16 numbers
            if offset + 8 <= te:
                w, h = struct.unpack_from(">II", data, offset)
                if w >> 16 and h >> 16 and (w >> 16) * (h >> 16) > info.get("width", 0) * info.get("height", 0):
                    info["width"], info["height"] = w >> 16, h >> 16
        if handler == b"soun" and mdia and (mdhd := _child(data, *mdia, b"mdhd")):
            ms = mdhd[0]
            if mdhd[1] - ms >= 16:
                rate = struct.unpack_from(">I", data, ms + (20 if data[ms] == 1 else 12))[0]
                if 0 < rate <= 384_000:
                    info.setdefault("sample_rate", rate)
    info["has_video"], info["has_audio"] = has_video, has_audio
    return info


# ---------- AVI ----------


def avi_info(data: bytes) -> dict:
    info: dict = {"format": "avi"}
    for fourcc, s, e in _riff_chunks(data, 12, min(len(data), 1 << 20)):
        if fourcc != b"LIST" or data[s : s + 4] != b"hdrl":
            continue
        for sub, ss, se in _riff_chunks(data, s + 4, e):
            if sub == b"avih" and se - ss >= 40:
                usec, _, _, _, frames, _, _, _, w, h = struct.unpack_from("<10I", data, ss)
                if usec and frames:
                    info["duration_s"] = round(frames * usec / 1_000_000, 3)
                if w and h:
                    info["width"], info["height"] = w, h
                return info
    return info


# ---------- WebM (EBML) ----------

_EBML_MASTER = {0x18538067, 0x1549A966, 0x1654AE6B, 0xAE, 0xE0, 0xE1}  # Segment, Info, Tracks, TrackEntry, Video, Audio
_CLUSTER = 0x1F43B675


def _vint(data: bytes, pos: int, keep_marker: bool) -> tuple[int, int] | None:
    if pos >= len(data) or data[pos] == 0:
        return None
    first = data[pos]
    length = 8 - first.bit_length() + 1
    if pos + length > len(data):
        return None
    value = first if keep_marker else first & (0xFF >> length)
    for b in data[pos + 1 : pos + length]:
        value = (value << 8) | b
    return value, length


def _ebml_float(raw: bytes) -> float | None:
    if len(raw) == 4:
        return struct.unpack(">f", raw)[0]
    if len(raw) == 8:
        return struct.unpack(">d", raw)[0]
    return None


def webm_info(data: bytes) -> dict:
    info: dict = {"format": "webm"}
    found: dict[int, bytes] = {}
    stack = [(0, len(data))]
    steps = 0
    while stack and steps < _MAX_BOXES:
        pos, end = stack.pop()
        while pos < end and steps < _MAX_BOXES:
            steps += 1
            ident = _vint(data, pos, True)
            if not ident:
                break
            size = _vint(data, pos + ident[1], False)
            if not size:
                break
            body = pos + ident[1] + size[1]
            unknown = size[0] == (1 << (7 * size[1])) - 1
            stop = end if unknown else min(body + size[0], end)
            if ident[0] == _CLUSTER:
                break  # the media itself starts here; every header field comes before it
            if ident[0] in _EBML_MASTER:
                stack.append((stop, end))
                pos, end = body, stop
                continue
            if ident[0] in (0x2AD7B1, 0x4489, 0xB0, 0xBA, 0xB5, 0x9F) and ident[0] not in found:
                found[ident[0]] = data[body:stop]
            pos = stop
    scale = int.from_bytes(found.get(0x2AD7B1, b""), "big") or 1_000_000
    if (duration := _ebml_float(found.get(0x4489, b""))) and duration > 0:
        info["duration_s"] = round(duration * scale / 1e9, 3)
    w, h = int.from_bytes(found.get(0xB0, b""), "big"), int.from_bytes(found.get(0xBA, b""), "big")
    if w and h:
        info["width"], info["height"] = w, h
    if (rate := _ebml_float(found.get(0xB5, b""))) and 0 < rate <= 384_000:
        info["sample_rate"] = int(rate)
    if channels := int.from_bytes(found.get(0x9F, b""), "big"):
        info["channels"] = channels
    return info


# ---------- Ogg (Vorbis, Opus) ----------


def ogg_info(data: bytes) -> dict:
    info: dict = {"format": "ogg"}
    if len(data) < 28 or data[:4] != b"OggS":
        return info
    body = 27 + data[26]
    packet = data[body : body + 64]
    rate, skip = 0, 0
    if packet[:7] == b"\x01vorbis" and len(packet) >= 16:
        info["codec"] = "vorbis"
        info["channels"], rate = packet[11], struct.unpack_from("<I", packet, 12)[0]
        info["sample_rate"] = rate
    elif packet[:8] == b"OpusHead" and len(packet) >= 16:
        info["codec"] = "opus"
        info["channels"], skip = packet[9], struct.unpack_from("<H", packet, 10)[0]
        info["sample_rate"], rate = struct.unpack_from("<I", packet, 12)[0], 48000  # Opus always counts at 48 kHz
    last = data.rfind(b"OggS", max(0, len(data) - 65_536))
    if rate and last >= 0 and last + 14 <= len(data):
        granule = struct.unpack_from("<q", data, last + 6)[0]
        if granule > skip:
            info["duration_s"] = round((granule - skip) / rate, 3)
    return info


# ---------- the one entry point ----------


def probe(data: bytes, media_type: str) -> dict:
    """The details of a photo, video or sound file, plus its kind. Raises FileRejected only for an undecodable image."""
    kind = kind_of(media_type)
    if kind == "photo":
        info = image_info(data)
    else:
        try:
            info = _probe_av(data, media_type)
        except (struct.error, IndexError, ValueError, OverflowError):
            info = {}  # malformed header: stored with what is known, never refused for this alone
    info = {k: v for k, v in info.items() if v is not None and k not in ("has_video", "has_audio")}
    return {"kind": kind, **info}


def _probe_av(data: bytes, media_type: str) -> dict:
    if media_type == "audio/wav":
        return wav_info(data)
    if media_type == "audio/mpeg":
        return mp3_info(data)
    if media_type == "audio/ogg":
        return ogg_info(data)
    if media_type == "video/x-msvideo":
        return avi_info(data)
    if media_type == "video/webm":
        return webm_info(data)
    fmt = {"video/mp4": "mp4", "video/quicktime": "mov", "audio/mp4": "m4a"}.get(media_type)
    return isobmff_info(data, fmt) if fmt else {}


def clock(seconds: float | None) -> str | None:
    if seconds is None:
        return None
    total = int(round(seconds))
    h, rest = divmod(total, 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def describe(info: dict | None) -> str:
    """One line for a result row: "Video · 0:42 · 1280×720"."""
    info = info or {}
    kind = info.get("kind", "document")
    parts = [LABEL.get(kind, "Document")]
    if c := clock(info.get("duration_s")):
        parts.append(c)
    if info.get("width") and info.get("height"):
        parts.append(f"{info['width']}×{info['height']}")
    if kind == "audio" and info.get("sample_rate"):
        parts.append(f"{info['sample_rate'] / 1000:g} kHz" + (" stereo" if info.get("channels") == 2 else ""))
    if info.get("taken"):
        parts.append(f"taken {info['taken'][:10]}")
    if info.get("camera"):
        parts.append(info["camera"])
    return " · ".join(parts)


def page_text(info: dict, name: str = "") -> str:
    """The only "page" a media file has: its name and details, so a word search for either can find it."""
    named = f"{name} · " if name else ""
    return f"[{named}{describe(info)}. VAULT stored this file but does not look inside photos, video or sound.]"
