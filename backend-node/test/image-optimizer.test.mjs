import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
  optimizeBuffer,
  optimizeFileToDataUrl,
  readExifTakenAt,
  PHOTO_MAX_DIM,
  PHOTO_JPEG_QUALITY,
} = require('../src/lib/image-optimizer');

describe('image-optimizer', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgopt-test-'));
  });
  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('redimensionne les images >1600px en JPEG', async () => {
    const big = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).png().toBuffer();
    const out = await optimizeBuffer(big);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBeLessThanOrEqual(PHOTO_MAX_DIM);
    expect(meta.height).toBeLessThanOrEqual(PHOTO_MAX_DIM);
    expect(out.length).toBeLessThan(big.length);
  });

  it('ne grossit pas les petites images (withoutEnlargement)', async () => {
    const small = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 0, g: 200, b: 0 } },
    }).png().toBuffer();
    const out = await optimizeBuffer(small);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(300);
  });

  it('optimizeFileToDataUrl renvoie une data URL JPEG + cache disque', async () => {
    const src = path.join(tmpDir, 'in.png');
    const buf = await sharp({
      create: { width: 2000, height: 1500, channels: 3, background: { r: 100, g: 100, b: 200 } },
    }).png().toBuffer();
    fs.writeFileSync(src, buf);

    const url = await optimizeFileToDataUrl(src);
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    const cachePath = path.join(tmpDir, '.optimized', 'in.png.jpg');
    expect(fs.existsSync(cachePath)).toBe(true);

    const url2 = await optimizeFileToDataUrl(src);
    expect(url2).toBe(url);
  });

  it('SVG passe sans transformation', async () => {
    const src = path.join(tmpDir, 'logo.svg');
    fs.writeFileSync(src, '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    const url = await optimizeFileToDataUrl(src);
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('renvoie null si le fichier n\'existe pas', async () => {
    const url = await optimizeFileToDataUrl('/path/inexistant/zzz.png');
    expect(url).toBeNull();
  });

  it('readExifTakenAt extrait DateTimeOriginal d\'un buffer JPEG', () => {
    const buf = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
      Buffer.alloc(64),
      Buffer.from('2026:04:15 14:32:18\0', 'latin1'),
      Buffer.alloc(8),
      Buffer.from([0xff, 0xd9]),
    ]);
    expect(readExifTakenAt(buf)).toBe('2026-04-15T14:32:18');
  });

  it('readExifTakenAt renvoie null si aucune date', () => {
    expect(readExifTakenAt(Buffer.from('hello world'))).toBeNull();
    expect(readExifTakenAt(null)).toBeNull();
  });

  it('readExifTakenAt prend la plus ancienne si plusieurs dates', () => {
    const buf = Buffer.from(
      '2026:04:15 14:32:18\0..2024:01:02 03:04:05\0..2025:06:07 08:09:10\0',
      'latin1'
    );
    expect(readExifTakenAt(buf)).toBe('2024-01-02T03:04:05');
  });

  it('PHOTO_MAX_DIM et PHOTO_JPEG_QUALITY sont exportes', () => {
    expect(PHOTO_MAX_DIM).toBe(1600);
    expect(PHOTO_JPEG_QUALITY).toBe(82);
  });
});
