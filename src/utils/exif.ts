import exifr from 'exifr';
import { formatLocalDateTime, type PhotoMeta } from '../../shared/photoSessions.ts';

export interface ExtractedPhoto {
  meta: PhotoMeta;
  file: File;
  previewUrl: string;
}

function toValidDate(val: unknown): Date | null {
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val;
  }
  if (typeof val === 'string' && val.trim()) {
    // EXIF dates sometimes look like "2026:06:18 07:30:15"
    const normalized = val.trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

/**
 * Extracts EXIF DateTimeOriginal / CreateDate and GPS coordinates from an image File.
 * Falls back to `file.lastModified` when no EXIF timestamp is present.
 */
export async function extractPhotoMeta(file: File, index: number): Promise<ExtractedPhoto> {
  const id = `${file.name}-${file.size}-${file.lastModified}-${index}`;
  const previewUrl = URL.createObjectURL(file);

  let takenDate: Date | null = null;
  let dateSource: PhotoMeta['dateSource'] = 'none';
  let lat: number | null = null;
  let lng: number | null = null;

  try {
    const parsed = await exifr.parse(file, {
      tiff: true,
      exif: true,
      gps: true,
    });

    if (parsed) {
      takenDate =
        toValidDate(parsed.DateTimeOriginal) ??
        toValidDate(parsed.CreateDate) ??
        toValidDate(parsed.ModifyDate);

      if (takenDate) {
        dateSource = 'exif';
      }

      if (
        typeof parsed.latitude === 'number' &&
        typeof parsed.longitude === 'number' &&
        !Number.isNaN(parsed.latitude) &&
        !Number.isNaN(parsed.longitude)
      ) {
        lat = parsed.latitude;
        lng = parsed.longitude;
      }
    }
  } catch {
    // Some formats (e.g., PNGs without EXIF or stripped JPEGs) may throw; fall back gracefully
  }

  if (!takenDate && file.lastModified) {
    const fallback = new Date(file.lastModified);
    if (!Number.isNaN(fallback.getTime())) {
      takenDate = fallback;
      dateSource = 'file';
    }
  }

  return {
    meta: {
      id,
      fileName: file.name,
      takenAt: takenDate ? formatLocalDateTime(takenDate) : null,
      dateSource,
      lat,
      lng,
    },
    file,
    previewUrl,
  };
}

export async function extractPhotosMeta(files: FileList | File[]): Promise<ExtractedPhoto[]> {
  const list = Array.from(files);
  return Promise.all(list.map((file, idx) => extractPhotoMeta(file, idx)));
}
