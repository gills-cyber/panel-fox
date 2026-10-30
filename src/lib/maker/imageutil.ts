/** Image helpers: sizes read from the file header, data URLs, and the folder's file order. */

export const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"];

/** One image the chapter is made from: its file name and bytes. */
export type ImageFile = { name: string; bytes: Uint8Array; size?: number; lastModified?: number };

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i).toLowerCase() : "";
}

export function isImageName(name: string): boolean {
  return IMAGE_EXTS.includes(extOf(name));
}

/** Python's natural_key: "img2" before "img10", case ignored. */
export function naturalKey(name: string): (number | string)[] {
  const parts = name.split(/(\p{Nd}+)/u);
  return parts.map((t, i) => (i % 2 === 1 ? parseInt(t.normalize("NFKC"), 10) || 0 : t.toLowerCase()));
}

export function compareNatural(a: string, b: string): number {
  const x = naturalKey(a);
  const y = naturalKey(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const p = x[i]!;
    const q = y[i]!;
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p - q;
    const ps = String(p);
    const qs = String(q);
    return ps < qs ? -1 : 1;
  }
  return x.length - y.length;
}

/** The images of a folder, in natural file order. */
export function sortImages<T extends { name: string }>(files: T[]): T[] {
  return files.filter((f) => isImageName(f.name)).sort((a, b) => compareNatural(a.name, b.name));
}

export function mimeFor(name: string): string {
  const ext = extOf(name);
  return (
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".bmp": "image/bmp",
    } as Record<string, string>
  )[ext] ?? "application/octet-stream";
}

export function base64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

export function dataUrl(img: { name: string; bytes: Uint8Array }): string {
  return `data:${mimeFor(img.name)};base64,${base64(img.bytes)}`;
}

function u16be(d: Uint8Array, i: number) {
  return (d[i]! << 8) | d[i + 1]!;
}
function u32be(d: Uint8Array, i: number) {
  return ((d[i]! << 24) >>> 0) + (d[i + 1]! << 16) + (d[i + 2]! << 8) + d[i + 3]!;
}
function u16le(d: Uint8Array, i: number) {
  return d[i]! | (d[i + 1]! << 8);
}
function i32le(d: Uint8Array, i: number) {
  return d[i]! | (d[i + 1]! << 8) | (d[i + 2]! << 16) | (d[i + 3]! << 24);
}
function startsWith(d: Uint8Array, at: number, sig: number[] | string) {
  const s = typeof sig === "string" ? Array.from(sig, (c) => c.charCodeAt(0)) : sig;
  if (d.length < at + s.length) return false;
  return s.every((b, k) => d[at + k] === b);
}

/** The Orientation tag (1-8) from an EXIF (TIFF) block, 1 if absent. */
export function exifOrientation(tiff: Uint8Array): number {
  try {
    const le = tiff[0] === 0x49 && tiff[1] === 0x49;
    const r16 = (i: number) => {
      if (i + 2 > tiff.length) throw new Error("short");
      return le ? u16le(tiff, i) : u16be(tiff, i);
    };
    const r32 = (i: number) => {
      if (i + 4 > tiff.length) throw new Error("short");
      return le ? (tiff[i]! | (tiff[i + 1]! << 8) | (tiff[i + 2]! << 16) | (tiff[i + 3]! << 24)) >>> 0 : u32be(tiff, i);
    };
    const off = r32(4);
    const count = r16(off);
    for (let k = 0; k < count; k++) {
      const e = off + 2 + 12 * k;
      if (r16(e) === 0x0112) return r16(e + 8);
    }
  } catch {
    /* no orientation */
  }
  return 1;
}

/** The Orientation from a PNG's eXIf chunk before its image data, 1 if absent. */
function pngOrientation(d: Uint8Array): number {
  let i = 8;
  try {
    while (i + 8 <= d.length) {
      const n = u32be(d, i);
      const kind = String.fromCharCode(d[i + 4]!, d[i + 5]!, d[i + 6]!, d[i + 7]!);
      if (kind === "IDAT" || kind === "IEND") break;
      if (kind === "eXIf") return exifOrientation(d.subarray(i + 8, i + 8 + n));
      i += 12 + n;
    }
  } catch {
    /* no orientation */
  }
  return 1;
}

/** JPEG EXIF orientation (1 if none). */
export function jpegOrientation(d: Uint8Array): number {
  if (!(d[0] === 0xff && d[1] === 0xd8)) return 1;
  let i = 2;
  while (i + 3 < d.length) {
    if (d[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = d[i + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = u16be(d, i + 2);
    if (marker === 0xe1 && startsWith(d, i + 4, [0x45, 0x78, 0x69, 0x66, 0, 0])) {
      return exifOrientation(d.subarray(i + 10, i + 2 + len));
    }
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return 1;
}

/** Orientation the editor applies when it shows the image (JPEG and PNG; WebP as stored). */
export function displayOrientation(d: Uint8Array): number {
  if (startsWith(d, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return pngOrientation(d);
  if (d[0] === 0xff && d[1] === 0xd8) return jpegOrientation(d);
  return 1;
}

/** (width, height) as the editor shows the image, read from the file header. */
export function imageSize(d: Uint8Array): [number, number] {
  try {
    if (startsWith(d, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      const w = u32be(d, 16);
      const h = u32be(d, 20);
      return [5, 6, 7, 8].includes(pngOrientation(d)) ? [h, w] : [w, h];
    }
    if (startsWith(d, 0, "GIF87a") || startsWith(d, 0, "GIF89a")) return [u16le(d, 6), u16le(d, 8)];
    if (startsWith(d, 0, "BM")) return [Math.abs(i32le(d, 18)), Math.abs(i32le(d, 22))];
    if (d[0] === 0xff && d[1] === 0xd8) {
      let i = 2;
      let orientation = 1;
      while (i < d.length) {
        if (d[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = d[i + 1]!;
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }
        if (i + 4 > d.length) break;
        const len = u16be(d, i + 2);
        if (marker === 0xe1 && startsWith(d, i + 4, [0x45, 0x78, 0x69, 0x66, 0, 0])) {
          orientation = exifOrientation(d.subarray(i + 10, i + 2 + len));
        }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const h = u16be(d, i + 5);
          const w = u16be(d, i + 7);
          return [5, 6, 7, 8].includes(orientation) ? [h, w] : [w, h];
        }
        i += 2 + len;
      }
    }
    if (startsWith(d, 0, "RIFF") && startsWith(d, 8, "WEBP")) {
      const chunk = String.fromCharCode(d[12]!, d[13]!, d[14]!, d[15]!);
      if (chunk === "VP8X") {
        const w = (d[24]! | (d[25]! << 8) | (d[26]! << 16)) + 1;
        const h = (d[27]! | (d[28]! << 8) | (d[29]! << 16)) + 1;
        return [w, h];
      }
      if (chunk === "VP8L") {
        const b0 = d[21]!, b1 = d[22]!, b2 = d[23]!, b3 = d[24]!;
        const w = 1 + (((b1 & 0x3f) << 8) | b0);
        const h = 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        return [w, h];
      }
      if (chunk === "VP8 ") return [u16le(d, 26) & 0x3fff, u16le(d, 28) & 0x3fff];
    }
  } catch {
    /* unknown */
  }
  return [1000, 1414]; // unknown: assume a portrait page
}
