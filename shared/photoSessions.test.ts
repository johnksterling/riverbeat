import { describe, it, expect } from 'vitest';
import {
  findNearestLocation,
  formatDuration,
  groupPhotosIntoSessions,
  haversineMiles,
  type PhotoMeta,
} from './photoSessions.ts';
import type { Location } from './types.ts';

const MOCK_LOCATIONS: Location[] = [
  {
    id: 1,
    name: 'Hirschdale & Boca Confluence',
    latitude: 39.3871,
    longitude: -120.0955,
    water_body: 'Truckee River',
    usgs_site_no: '10344505',
    notes: '',
    created_at: '2026-01-01',
  },
  {
    id: 2,
    name: 'Farad / Floriston Canyon',
    latitude: 39.4285,
    longitude: -120.0332,
    water_body: 'Truckee River',
    usgs_site_no: '10346000',
    notes: '',
    created_at: '2026-01-01',
  },
];

describe('photoSessions clustering & location matching', () => {
  it('groups photos within time & distance thresholds into distinct sessions and matches River Beats', () => {
    const photos: PhotoMeta[] = [
      {
        id: 'p1',
        fileName: 'IMG_001.jpg',
        takenAt: '2026-06-18T07:30:00',
        dateSource: 'exif',
        lat: 39.3875,
        lng: -120.095,
      },
      {
        id: 'p2',
        fileName: 'IMG_002.jpg',
        takenAt: '2026-06-18T09:15:00',
        dateSource: 'exif',
        lat: 39.388,
        lng: -120.096,
      },
      {
        id: 'p3',
        fileName: 'IMG_003.jpg',
        takenAt: '2026-06-19T14:00:00',
        dateSource: 'exif',
        lat: 39.429,
        lng: -120.033,
      },
    ];

    const sessions = groupPhotosIntoSessions(photos, MOCK_LOCATIONS);
    expect(sessions).toHaveLength(2);

    expect(sessions[0].photoIds).toEqual(['p1', 'p2']);
    expect(sessions[0].matchedLocationId).toBe(1);
    expect(sessions[0].durationMinutes).toBe(105);
    expect(sessions[0].title).toContain('Hirschdale & Boca Confluence');

    expect(sessions[1].photoIds).toEqual(['p3']);
    expect(sessions[1].matchedLocationId).toBe(2);
    expect(sessions[1].durationMinutes).toBeNull();
  });

  it('splits photos taken close in time if GPS coordinates are far apart', () => {
    const photos: PhotoMeta[] = [
      {
        id: 'a',
        fileName: 'A.jpg',
        takenAt: '2026-07-10T08:00:00',
        dateSource: 'exif',
        lat: 39.3871,
        lng: -120.0955,
      },
      {
        id: 'b',
        fileName: 'B.jpg',
        takenAt: '2026-07-10T10:00:00',
        dateSource: 'exif',
        lat: 39.5313,
        lng: -119.7849, // ~19 miles away in Reno
      },
    ];

    const sessions = groupPhotosIntoSessions(photos, MOCK_LOCATIONS, {
      maxGapHours: 6,
      maxDistanceMiles: 5,
    });
    expect(sessions).toHaveLength(2);
    expect(sessions[0].photoIds).toEqual(['a']);
    expect(sessions[1].photoIds).toEqual(['b']);
    expect(sessions[1].matchedLocationId).toBeNull();
  });

  it('calculates haversine distance, nearest location, and duration formatting accurately', () => {
    const dist = haversineMiles(39.3871, -120.0955, 39.4285, -120.0332);
    expect(dist).toBeGreaterThan(3);
    expect(dist).toBeLessThan(6);

    const nearest = findNearestLocation(39.3872, -120.0954, MOCK_LOCATIONS, 5);
    expect(nearest?.location.id).toBe(1);

    expect(formatDuration(95)).toBe('1h 35m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(120)).toBe('2h');
  });
});
