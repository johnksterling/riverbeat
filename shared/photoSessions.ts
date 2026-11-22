import type { Location } from './types.ts';

export interface PhotoMeta {
  id: string;
  fileName: string;
  takenAt: string | null; // ISO or local datetime string parseable by Date
  dateSource: 'exif' | 'file' | 'none';
  lat: number | null;
  lng: number | null;
}

export interface DerivedPhotoSession {
  id: string;
  title: string;
  tripDate: string; // YYYY-MM-DDTHH:mm
  endDate: string; // YYYY-MM-DDTHH:mm
  durationMinutes: number | null;
  photoIds: string[];
  centroidLat: number | null;
  centroidLng: number | null;
  matchedLocationId: number | null;
  matchedDistanceMiles: number | null;
}

export interface GroupPhotosOptions {
  maxGapHours?: number;
  maxDistanceMiles?: number;
  maxLocationMatchMiles?: number;
}

/**
 * Computes great-circle distance in miles between two WGS84 coordinates.
 */
export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Formats a Date into `YYYY-MM-DDTHH:mm` in local wall-clock time for `<input type="datetime-local">`.
 */
export function formatLocalDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * Formats a duration in minutes into a compact human-readable label (e.g. `1h 25m` or `45m`).
 */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Returns a natural time-of-day label for a Date.
 */
export function getTimeOfDayLabel(date: Date): string {
  const hour = date.getHours();
  if (hour < 11) return 'Morning';
  if (hour < 14) return 'Midday';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}

/**
 * Finds the nearest saved Location within `maxMiles` of `(lat, lng)`.
 */
export function findNearestLocation(
  lat: number,
  lng: number,
  locations: Location[],
  maxMiles = 10
): { location: Location; distanceMiles: number } | null {
  let best: { location: Location; distanceMiles: number } | null = null;
  for (const loc of locations) {
    const dist = haversineMiles(lat, lng, loc.latitude, loc.longitude);
    if (dist <= maxMiles && (!best || dist < best.distanceMiles)) {
      best = { location: loc, distanceMiles: dist };
    }
  }
  return best;
}

function computeCentroid(coords: Array<{ lat: number; lng: number }>): {
  lat: number | null;
  lng: number | null;
} {
  if (coords.length === 0) return { lat: null, lng: null };
  const sumLat = coords.reduce((s, c) => s + c.lat, 0);
  const sumLng = coords.reduce((s, c) => s + c.lng, 0);
  return {
    lat: sumLat / coords.length,
    lng: sumLng / coords.length,
  };
}

/**
 * Clusters a batch of photos into retroactive fishing sessions by timestamp proximity
 * and GPS distance, then matches each session to the nearest saved River Beat.
 */
export function groupPhotosIntoSessions(
  photos: PhotoMeta[],
  locations: Location[],
  options: GroupPhotosOptions = {}
): DerivedPhotoSession[] {
  if (photos.length === 0) return [];

  const maxGapMs = (options.maxGapHours ?? 6) * 3600 * 1000;
  const maxDistanceMiles = options.maxDistanceMiles ?? 5;
  const maxLocationMatchMiles = options.maxLocationMatchMiles ?? 10;

  const dated: Array<{ photo: PhotoMeta; timeMs: number }> = [];
  const undated: PhotoMeta[] = [];

  for (const photo of photos) {
    if (photo.takenAt) {
      const ms = new Date(photo.takenAt).getTime();
      if (!Number.isNaN(ms)) {
        dated.push({ photo, timeMs: ms });
        continue;
      }
    }
    undated.push(photo);
  }

  dated.sort((a, b) => a.timeMs - b.timeMs);

  const groups: Array<Array<{ photo: PhotoMeta; timeMs: number }>> = [];

  for (const item of dated) {
    const currentGroup = groups[groups.length - 1];
    if (!currentGroup) {
      groups.push([item]);
      continue;
    }

    const prevItem = currentGroup[currentGroup.length - 1];
    const gapMs = item.timeMs - prevItem.timeMs;

    let withinDistance = true;
    if (item.photo.lat !== null && item.photo.lng !== null) {
      const groupCoords = currentGroup
        .map((g) => g.photo)
        .filter((p): p is PhotoMeta & { lat: number; lng: number } => p.lat !== null && p.lng !== null);
      if (groupCoords.length > 0) {
        const centroid = computeCentroid(groupCoords);
        if (centroid.lat !== null && centroid.lng !== null) {
          const dist = haversineMiles(centroid.lat, centroid.lng, item.photo.lat, item.photo.lng);
          withinDistance = dist <= maxDistanceMiles;
        }
      }
    }

    if (gapMs <= maxGapMs && withinDistance) {
      currentGroup.push(item);
    } else {
      groups.push([item]);
    }
  }

  const sessions: DerivedPhotoSession[] = groups.map((group, idx) => {
    const firstDate = new Date(group[0].timeMs);
    const lastDate = new Date(group[group.length - 1].timeMs);
    const diffMinutes = Math.round((group[group.length - 1].timeMs - group[0].timeMs) / 60000);
    const durationMinutes = diffMinutes >= 5 ? diffMinutes : null;

    const coords = group
      .map((g) => g.photo)
      .filter((p): p is PhotoMeta & { lat: number; lng: number } => p.lat !== null && p.lng !== null);
    const centroid = computeCentroid(coords);

    const matched =
      centroid.lat !== null && centroid.lng !== null
        ? findNearestLocation(centroid.lat, centroid.lng, locations, maxLocationMatchMiles)
        : null;

    const timeOfDay = getTimeOfDayLabel(firstDate);
    const shortDate = firstDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const title = matched
      ? `${timeOfDay} Session — ${matched.location.name}`
      : `${timeOfDay} Fishing Session — ${shortDate}`;

    return {
      id: `session-${idx + 1}-${group[0].timeMs}`,
      title,
      tripDate: formatLocalDateTime(firstDate),
      endDate: formatLocalDateTime(lastDate),
      durationMinutes,
      photoIds: group.map((g) => g.photo.id),
      centroidLat: centroid.lat,
      centroidLng: centroid.lng,
      matchedLocationId: matched ? matched.location.id : null,
      matchedDistanceMiles: matched ? Number(matched.distanceMiles.toFixed(2)) : null,
    };
  });

  if (undated.length > 0) {
    const now = new Date();
    const coords = undated.filter(
      (p): p is PhotoMeta & { lat: number; lng: number } => p.lat !== null && p.lng !== null
    );
    const centroid = computeCentroid(coords);
    const matched =
      centroid.lat !== null && centroid.lng !== null
        ? findNearestLocation(centroid.lat, centroid.lng, locations, maxLocationMatchMiles)
        : null;

    sessions.push({
      id: `session-undated-${now.getTime()}`,
      title: matched ? `Fishing Session — ${matched.location.name}` : 'Undated Photo Session',
      tripDate: formatLocalDateTime(now),
      endDate: formatLocalDateTime(now),
      durationMinutes: null,
      photoIds: undated.map((p) => p.id),
      centroidLat: centroid.lat,
      centroidLng: centroid.lng,
      matchedLocationId: matched ? matched.location.id : null,
      matchedDistanceMiles: matched ? Number(matched.distanceMiles.toFixed(2)) : null,
    });
  }

  return sessions;
}
