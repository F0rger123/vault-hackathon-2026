// F09.21: tests for the local QR encoder. Run with `npm run test:qr` (Node 22.18+ runs the .ts file directly).
// Known values come from the QR standard's worked examples; the round trip reads a code back with an independent
// reader written below (format bits, unmasking, zigzag order, de-interleaving) and checks the bytes.
import assert from "node:assert/strict";
import test from "node:test";
import { alignmentPositions, codewords, encodeQr, formatBits, rsDivisor, rsRemainder, versionBits, versionFor } from "../src/lib/qr.ts";

test("Reed-Solomon matches the HELLO WORLD 1-M example", () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(rsRemainder(data, rsDivisor(10)), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test("format and version bits match the standard's tables", () => {
  assert.equal(formatBits(1, 0), 0b111011111000100); // L, mask 0
  assert.equal(formatBits(0, 0), 0b101010000010010); // M, mask 0
  assert.equal(formatBits(3, 0), 0b011010101011111); // Q, mask 0
  assert.equal(formatBits(2, 0), 0b001011010001001); // H, mask 0
  assert.equal(versionBits(7), 0b000111110010010100);
  assert.equal(versionBits(10), 0b001010010011010011);
});

test("alignment pattern centres and capacities", () => {
  assert.deepEqual(alignmentPositions(1), []);
  assert.deepEqual(alignmentPositions(2), [6, 18]);
  assert.deepEqual(alignmentPositions(7), [6, 22, 38]);
  assert.deepEqual(alignmentPositions(10), [6, 28, 50]);
  // Byte-mode capacity at level M: 14, 26, 42, 62 ... 213 bytes.
  assert.equal(versionFor(14), 1);
  assert.equal(versionFor(15), 2);
  assert.equal(versionFor(42), 3);
  assert.equal(versionFor(62), 4);
  assert.equal(versionFor(213), 10);
  assert.equal(versionFor(214), null);
});

const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

/** A deliberately separate reader: returns the text a scanner would get from the matrix. */
function read(m) {
  const size = m.length;
  const ver = (size - 17) / 4;
  // Format bits, first copy, and the same bits from the second copy.
  const at = (x, y) => (m[y][x] ? 1 : 0);
  const first = [0, 1, 2, 3, 4, 5, 7, 8].map((y) => at(8, y)).concat([7, 5, 4, 3, 2, 1, 0].map((x) => at(x, 8)));
  const second = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => at(size - 1 - i, 8)).concat([8, 9, 10, 11, 12, 13, 14].map((i) => at(8, size - 15 + i)));
  assert.deepEqual(first, second, "the two format copies agree");
  const fmt = first.reduce((acc, b, i) => acc | (b << i), 0);
  const mask = (fmt ^ 0x5412) >>> 10 & 7;
  assert.equal(((fmt ^ 0x5412) >>> 13) & 3, 0, "level M");
  assert.equal(fmt, formatBits(0, mask));
  assert.equal(at(8, size - 8), 1, "dark module");
  // Which modules are function patterns, worked out independently of the encoder.
  const isFn = (x, y) => {
    if ((x < 9 && y < 9) || (x >= size - 8 && y < 9) || (x < 9 && y >= size - 8)) return true;
    if (x === 6 || y === 6) return true;
    if (ver >= 7 && ((x >= size - 11 && x < size - 8 && y < 6) || (y >= size - 11 && y < size - 8 && x < 6))) return true;
    const al = alignmentPositions(ver);
    for (const ay of al)
      for (const ax of al) {
        const corner = (ax === 6 && ay === 6) || (ax === 6 && ay === al.at(-1)) || (ax === al.at(-1) && ay === 6);
        if (!corner && Math.abs(x - ax) <= 2 && Math.abs(y - ay) <= 2) return true;
      }
    return false;
  };
  const maskFn = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ][mask];
  const bits = [];
  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < size; k++) {
      const y = up ? size - 1 - k : k;
      for (const x of [col, col - 1]) if (!isFn(x, y)) bits.push(m[y][x] !== maskFn(x, y) ? 1 : 0);
    }
    up = !up;
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  // De-interleave: short blocks first, each block's data then its error correction.
  const n = BLOCKS[ver];
  const total = bytes.length;
  const shortLen = Math.floor(total / n);
  const numShort = n - (total % n);
  const blocks = Array.from({ length: n }, () => []);
  let k = 0;
  for (let i = 0; i < shortLen + 1; i++)
    for (let b = 0; b < n; b++) {
      const len = shortLen + (b < numShort ? 0 : 1);
      const dataLen = len - ECC[ver];
      if (i < dataLen) blocks[b].push(bytes[k++]);
    }
  // Remaining bytes are error correction, interleaved the same way.
  const eccBlocks = Array.from({ length: n }, () => []);
  for (let i = 0; i < ECC[ver]; i++) for (let b = 0; b < n; b++) eccBlocks[b].push(bytes[k++]);
  blocks.forEach((d, b) => assert.deepEqual(rsRemainder(d, rsDivisor(ECC[ver])), eccBlocks[b], `block ${b} checks out`));
  const data = blocks.flat();
  const stream = data.flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (byte >>> i) & 1));
  const take = (len) => stream.splice(0, len).reduce((a, b) => (a << 1) | b, 0);
  assert.equal(take(4), 0b0100, "byte mode");
  const count = take(ver < 10 ? 8 : 16);
  return new TextDecoder().decode(Uint8Array.from({ length: count }, () => take(8)));
}

test("round trip through an independent reader, every mask and many lengths", () => {
  const texts = [
    "A",
    "HELLO WORLD",
    "http://localhost:3000/join#7K2QM9XAB4C8DEFGHJ3N",
    "https://vault.example.internal:8443/join#0123456789ABCDEFGHJK",
    "x".repeat(120),
    "é".repeat(100),
    "z".repeat(213),
  ];
  for (const text of texts) {
    for (const mask of [undefined, 0, 1, 2, 3, 4, 5, 6, 7]) {
      const m = encodeQr(text, mask);
      assert.ok(m, `encodes ${text.length} chars`);
      assert.equal(read(m), text);
    }
  }
  assert.equal(encodeQr("z".repeat(214)), null);
});

test("finder patterns and timing lines are where scanners look", () => {
  const m = encodeQr("http://localhost:3000/join#7K2QM9XAB4C8DEFGHJ3N");
  const size = m.length;
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++) {
        const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        assert.equal(m[oy + y][ox + x], d !== 2, `finder at ${ox},${oy}`);
      }
  }
  for (let i = 8; i < size - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0);
    assert.equal(m[i][6], i % 2 === 0);
  }
  // The same input always gives the same code.
  assert.deepEqual(encodeQr("same"), encodeQr("same"));
  assert.ok(codewords([1, 2, 3], 1).length === 26);
});
