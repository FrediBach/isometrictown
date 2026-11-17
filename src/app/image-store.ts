/**
 * Images for image mode, on the main thread: decoded, turned upright, scaled to at most
 * 1024 px on the long side and read back as straight RGBA, then kept in Cache Storage by a
 * hash of those pixels, so the same picture gets the same id however it arrives. Without
 * Cache Storage, pictures last as long as the tab.
 */
import type { Picture } from '../image';
import { bytes, IMAGES, LOCAL, read, write } from '../netcache';

/** The longest side a picture is kept at, px. */
export const MAX_SIDE = 1024;
const MAGIC = 0x49545031; // "ITP1"
/** Pictures this tab has seen, for when Cache Storage isn't there or is slow to answer. */
const memory = new Map<string, Picture>();
const MEMORY = 3;

/** A file the browser can't read as an image, with a message that says so in plain words. */
export class UnreadableImage extends Error {}

const keyOf = (id: string) => `${LOCAL}image/${id}`;

function remember(p: Picture): void {
  memory.delete(p.id);
  memory.set(p.id, p);
  while (memory.size > MEMORY) memory.delete(memory.keys().next().value!);
}

/** The first 16 hex digits of the SHA-256 of a picture's size and pixels. */
export async function pictureId(rgba: Uint8ClampedArray, w: number, h: number): Promise<string> {
  const data = new Uint8Array(8 + rgba.length);
  new DataView(data.buffer).setUint32(0, w);
  new DataView(data.buffer).setUint32(4, h);
  data.set(rgba, 8);
  // Pages served over plain http (a dev server on the LAN) have no SubtleCrypto; two FNV-1a hashes do there.
  if (!globalThis.crypto?.subtle) {
    const fnv = (seed: number) => {
      let h = seed;
      for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 0x01000193);
      return (h >>> 0).toString(16).padStart(8, '0');
    };
    return fnv(0x811c9dc5) + fnv(0x2c1b3c6d);
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The name for the title from a file name: no extension, separators as spaces. */
export function nameOf(file: string): string {
  return file.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Decode an image file, upright and scaled down, and work out its id. */
export async function readPicture(file: Blob, name: string): Promise<Picture> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(name);
    throw new UnreadableImage(heic
      ? 'This browser can’t read HEIC photos. Export it as a JPEG or PNG first.'
      : 'This browser can’t read that file as an image. Try a PNG, JPEG or WebP.');
  }
  const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new UnreadableImage('This browser can’t read images here.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, w, h).data;
  return { id: await pictureId(rgba, w, h), name: nameOf(name), w, h, rgba };
}

/** A picture as stored: a small header, the name, then the pixels. */
export function encodePicture(p: Picture): ArrayBuffer {
  const name = new TextEncoder().encode(p.name);
  const buf = new ArrayBuffer(16 + name.length + p.rgba.length);
  const v = new DataView(buf);
  v.setUint32(0, MAGIC);
  v.setUint32(4, p.w);
  v.setUint32(8, p.h);
  v.setUint32(12, name.length);
  new Uint8Array(buf, 16, name.length).set(name);
  new Uint8Array(buf, 16 + name.length).set(p.rgba);
  return buf;
}

/** Read `encodePicture()` back; null for anything that isn't one. */
export function decodePicture(id: string, buf: ArrayBuffer): Picture | null {
  if (buf.byteLength < 16) return null;
  const v = new DataView(buf);
  const [w, h, n] = [v.getUint32(4), v.getUint32(8), v.getUint32(12)];
  if (v.getUint32(0) !== MAGIC || buf.byteLength !== 16 + n + w * h * 4) return null;
  const name = new TextDecoder().decode(new Uint8Array(buf, 16, n));
  return { id, name, w, h, rgba: new Uint8ClampedArray(buf, 16 + n) };
}

/** Keep a picture for later visits. */
export async function savePicture(p: Picture): Promise<void> {
  remember(p);
  await write(IMAGES, keyOf(p.id), encodePicture(p));
}

/** A stored picture by id, or null if this browser doesn't have it. */
export async function loadPicture(id: string): Promise<Picture | null> {
  const known = memory.get(id);
  if (known) return known;
  const hit = await read(IMAGES, keyOf(id), bytes, Infinity);
  const p = hit?.value ? decodePicture(id, hit.value) : null;
  if (p) remember(p);
  return p;
}

/** The picture as normalised, as a PNG, for showing it in the image well and the overlay. */
export async function pictureBlob(p: Picture): Promise<Blob> {
  const canvas = new OffscreenCanvas(p.w, p.h);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.rgba), p.w, p.h), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}
