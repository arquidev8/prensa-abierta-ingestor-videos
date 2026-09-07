#!/usr/bin/env node
// Sube `assets/contenido` (b-roll curado) y `assets/logos` a Cloudinary, y
// genera `src/data/cloudinary-manifest.json` con la metadata que
// `lib/contentLibrary.ts` necesita para servir ese contenido sin tocar el
// disco local (ver .doc/context.md, entrada de esta migración).
//
// Uso (desde apps/web, con CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET en el
// entorno o en el .env de la raíz del repo):
//   npm run migrate:cloudinary
//
// No borra nada local: assets/contenido y assets/logos quedan intactos en
// disco; esto solo sube copias a Cloudinary y registra sus URLs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v2 as cloudinary } from 'cloudinary';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const webRoot = path.resolve(__dirname, '..');

// Carga simple de `.env` (raíz del repo) sin depender de `dotenv`: solo
// completa variables que no estén ya definidas en el entorno del shell.
function loadDotEnvIfPresent(envPath) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
loadDotEnvIfPresent(path.join(repoRoot, '.env'));

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  console.error(
    'Faltan credenciales de Cloudinary. Definí CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y ' +
      'CLOUDINARY_API_SECRET (en el .env de la raíz del repo, o exportadas en el shell) y volvé a intentar.'
  );
  process.exit(1);
}

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
  secure: true,
});

const contenidoDir = path.join(repoRoot, 'assets', 'contenido');
const logosDir = path.join(repoRoot, 'assets', 'logos');
const manifestPath = path.join(webRoot, 'src', 'data', 'cloudinary-manifest.json');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function resourceTypeFor(ext) {
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return null;
}

// El endpoint normal de Cloudinary (`upload`) rechaza con 413 los archivos
// grandes (~100MB+, varios de los clips de b-roll superan eso). Los videos
// van siempre por `upload_large` (sube en chunks); las imágenes (siempre
// livianas acá) usan el endpoint simple.
//
// IMPORTANTE: a diferencia de `uploader.upload`, `uploader.upload_large` NO
// devuelve una Promise cuando se lo llama sin callback — internamente hace
// `fileStream.pipe(chunkedUploadStream)` y devuelve ESE stream de inmediato,
// antes de que la subida real termine. Un `await` directo sobre eso no
// espera nada: resuelve al toque con el objeto stream (sin `secure_url` ni
// `bytes`), y un error real (ej. el archivo supera el tamaño máximo del
// plan de Cloudinary) queda completamente silenciado. Por eso se envuelve
// a mano en una Promise con callback explícito.
function uploadLargeWithCallback(filePath, options) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_large(filePath, options, (err, result) => {
      if (err) reject(err instanceof Error ? err : new Error(err.message || JSON.stringify(err)));
      else resolve(result);
    });
  });
}

async function uploadFile(filePath, folder, publicId, resourceType) {
  const options = {
    resource_type: resourceType,
    folder,
    public_id: publicId,
    use_filename: false,
    unique_filename: false,
    overwrite: true,
  };
  if (resourceType === 'video') {
    return uploadLargeWithCallback(filePath, options);
  }
  return cloudinary.uploader.upload(filePath, options);
}

// Manifiesto de una corrida previa (si existe): permite volver a correr el
// script sin re-subir lo que ya se migró con éxito (p.ej. tras un corte de
// red o el fix de un archivo puntual que había fallado).
function loadExistingManifest(manifestPath) {
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { folders: {} };
  }
}

function findExisting(existingManifest, folderName, fileName) {
  const folder = existingManifest.folders && existingManifest.folders[folderName];
  if (!folder) return null;
  const match =
    (folder.videos || []).find((v) => v.fileName === fileName) ||
    (folder.images || []).find((v) => v.fileName === fileName) ||
    null;
  // Una corrida anterior con un bug pudo haber guardado una entrada
  // incompleta (sin `url`, ver `uploadLargeWithCallback`) — no cuenta como
  // "ya migrado": se reintenta la subida.
  return match && match.url ? match : null;
}

async function migrateContenido(existingManifest) {
  if (!fs.existsSync(contenidoDir)) {
    console.warn(`No existe ${contenidoDir}; se omite el banco de b-roll.`);
    return {};
  }

  const folderNames = fs
    .readdirSync(contenidoDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const folders = {};

  for (const folderName of folderNames) {
    const folderPath = path.join(contenidoDir, folderName);
    const files = fs.readdirSync(folderPath).filter((f) => resourceTypeFor(path.extname(f).toLowerCase()));

    const videos = [];
    const images = [];

    for (const fileName of files) {
      const ext = path.extname(fileName).toLowerCase();
      const resourceType = resourceTypeFor(ext);

      const existing = findExisting(existingManifest, folderName, fileName);
      if (existing) {
        console.log(`Ya migrado: ${folderName}/${fileName} (se omite)`);
        if (resourceType === 'video') videos.push(existing);
        else images.push(existing);
        continue;
      }

      const base = fileName.slice(0, -ext.length);
      const filePath = path.join(folderPath, fileName);

      process.stdout.write(`Subiendo ${folderName}/${fileName} (${resourceType})... `);
      try {
        const result = await uploadFile(
          filePath,
          `prensa-abierta/contenido/${folderName}`,
          base,
          resourceType
        );
        const entry = {
          fileName,
          url: result.secure_url,
          publicId: result.public_id,
          format: result.format || ext.replace('.', ''),
          bytes: result.bytes,
        };
        if (resourceType === 'video') videos.push(entry);
        else images.push(entry);
        console.log('OK');
      } catch (err) {
        console.log('FALLÓ');
        console.error(`  ${folderName}/${fileName}:`, err.message || err);
      }
    }

    folders[folderName] = { videos, images };
  }

  return folders;
}

async function migrateLogos() {
  if (!fs.existsSync(logosDir)) {
    console.warn(`No existe ${logosDir}; se omiten los logos.`);
    return {};
  }

  const files = fs
    .readdirSync(logosDir)
    .filter((f) => resourceTypeFor(path.extname(f).toLowerCase()) === 'image');

  const logos = {};
  for (const fileName of files) {
    const ext = path.extname(fileName).toLowerCase();
    const base = fileName.slice(0, -ext.length);
    const filePath = path.join(logosDir, fileName);

    process.stdout.write(`Subiendo logos/${fileName}... `);
    try {
      const result = await uploadFile(filePath, 'prensa-abierta/logos', base, 'image');
      logos[fileName] = {
        fileName,
        url: result.secure_url,
        publicId: result.public_id,
        format: result.format || ext.replace('.', ''),
        bytes: result.bytes,
      };
      console.log('OK');
    } catch (err) {
      console.log('FALLÓ');
      console.error(`  logos/${fileName}:`, err.message || err);
    }
  }
  return logos;
}

async function main() {
  console.log(`Cloudinary cloud: ${CLOUDINARY_CLOUD_NAME}\n`);

  const existingManifest = loadExistingManifest(manifestPath);
  const folders = await migrateContenido(existingManifest);
  const logos = await migrateLogos();

  const manifest = {
    generatedAt: new Date().toISOString(),
    folders,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log(`\nManifiesto escrito en ${path.relative(repoRoot, manifestPath)}`);

  const totalVideos = Object.values(folders).reduce((acc, f) => acc + f.videos.length, 0);
  const totalImages = Object.values(folders).reduce((acc, f) => acc + f.images.length, 0);
  console.log(`Total: ${totalVideos} videos, ${totalImages} imágenes, ${Object.keys(logos).length} logos.`);

  if (Object.keys(logos).length > 0) {
    console.log('\nAgregá estas dos líneas a tu .env (raíz del repo) para que el Go Engine use los logos de Cloudinary:');
    const logo = logos['prensa_abierta_logo.png'];
    const promo = logos['descargar-app-gratis.jpg'];
    console.log(`LOGO_URL=${logo ? logo.url : '(no encontrado)'}`);
    console.log(`PROMO_IMAGE_URL=${promo ? promo.url : '(no encontrado)'}`);
  }
}

main().catch((err) => {
  console.error('Migración falló:', err);
  process.exit(1);
});
