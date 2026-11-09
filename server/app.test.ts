import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from './db.ts';
import { createApp } from './app.ts';
import type { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';

async function withServer(
  db: DatabaseSync,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = createApp(db);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('RiverBeat API & SQLite Database', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  it('creates, updates, lists, and deletes Truckee River beats and fly-fishing sessions', async () => {
    await withServer(db, async (baseUrl) => {
      // 1. Create a Truckee River Location
      const locRes = await fetch(`${baseUrl}/api/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Hirschdale Bridge Pocket Water',
          latitude: 39.3871,
          longitude: -120.0955,
          water_body: 'Truckee River',
          usgs_site_no: '10344505',
          notes: 'Prime boulder pockets below Little Truckee confluence',
        }),
      });
      expect(locRes.status).toBe(201);
      const loc = await locRes.json();
      expect(loc.id).toBeGreaterThan(0);
      expect(loc.name).toBe('Hirschdale Bridge Pocket Water');
      expect(loc.usgs_site_no).toBe('10344505');

      // 2. Update the Location
      const updateLocRes = await fetch(`${baseUrl}/api/locations/${loc.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...loc,
          notes: 'Updated notes: best between 250 and 600 CFS',
        }),
      });
      expect(updateLocRes.status).toBe(200);
      const updatedLoc = await updateLocRes.json();
      expect(updatedLoc.notes).toBe('Updated notes: best between 250 and 600 CFS');

      // 3. Create a Fly-Fishing Session with rig_type, hatches, water_clarity, catches & river conditions
      const tripRes = await fetch(`${baseUrl}/api/trips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: 'Morning Euro-Nymphing Session at Hirschdale',
          trip_date: '2026-06-18T07:30',
          location_id: loc.id,
          score: 5,
          rig_type: 'Euro / Tight-Line Nymphing',
          hatches: 'PMD, Golden Stones, BWO',
          water_clarity: 'Clear',
          comments: "Fished 4X fluorocarbon to #8 Pat's Rubber Legs and 5X to #16 Olive Perdigon",
          river_flow_cfs: 465,
          gauge_height_ft: 3.92,
          water_temp_f: 55,
          weather_summary: 'Mainly Clear',
          air_temp_f: 66,
          catches: [
            {
              species: 'Wild Rainbow Trout',
              count: 4,
              length_inches: 18.5,
              weight_lbs: 2.6,
              fly_or_lure: '#16 Olive Perdigon',
              notes: 'Deep boulder seam',
            },
          ],
        }),
      });
      expect(tripRes.status).toBe(201);
      const trip = await tripRes.json();
      expect(trip.description).toBe('Morning Euro-Nymphing Session at Hirschdale');
      expect(trip.rig_type).toBe('Euro / Tight-Line Nymphing');
      expect(trip.hatches).toBe('PMD, Golden Stones, BWO');
      expect(trip.water_clarity).toBe('Clear');
      expect(trip.river_flow_cfs).toBe(465);
      expect(trip.catches).toHaveLength(1);
      expect(trip.catches[0].species).toBe('Wild Rainbow Trout');

      // 4. Update the Trip
      const updateTripRes = await fetch(`${baseUrl}/api/trips/${trip.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...trip,
          score: 4,
          catches: [
            ...trip.catches,
            {
              species: 'Brown Trout',
              count: 1,
              length_inches: 20,
              weight_lbs: 3.2,
              fly_or_lure: '#6 Olive Sculpzilla',
              notes: 'Undercut boulder',
            },
          ],
        }),
      });
      expect(updateTripRes.status).toBe(200);
      const updatedTrip = await updateTripRes.json();
      expect(updatedTrip.score).toBe(4);
      expect(updatedTrip.catches).toHaveLength(2);

      // 5. Search Trips by hatch or fly pattern
      const searchRes = await fetch(`${baseUrl}/api/trips?search=Sculpzilla`);
      const found = await searchRes.json();
      expect(found).toHaveLength(1);
      expect(found[0].id).toBe(trip.id);

      // 6. Verify Location stats reflect trip count and avg score
      const locsRes = await fetch(`${baseUrl}/api/locations`);
      const locs = await locsRes.json();
      expect(locs[0].trip_count).toBe(1);
      expect(locs[0].avg_score).toBe(4);

      // 7. Delete Location cascades to Trips
      const delLocRes = await fetch(`${baseUrl}/api/locations/${loc.id}`, { method: 'DELETE' });
      expect(delLocRes.status).toBe(200);

      const remainingRes = await fetch(`${baseUrl}/api/trips`);
      const remaining = await remainingRes.json();
      expect(remaining).toHaveLength(0);
    });
  });

  it('validates required fields and returns 400 / 404 appropriately', async () => {
    await withServer(db, async (baseUrl) => {
      const badLoc = await fetch(`${baseUrl}/api/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '', latitude: 'invalid', longitude: -120 }),
      });
      expect(badLoc.status).toBe(400);

      const missingTrip = await fetch(`${baseUrl}/api/trips/9999`);
      expect(missingTrip.status).toBe(404);
    });
  });
});
