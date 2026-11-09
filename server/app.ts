import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { UPLOADS_DIR, ensureDirectories } from './db.ts';
import {
  fetchTruckeeWatershedFlows,
  fetchUsgsSiteData,
  fetchWeatherConditions,
  findNearbyUsgsGauges,
} from './services/conditions.ts';
import type { CatchEntry, Location, Trip, TripImage } from '../shared/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

ensureDirectories();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDirectories();
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, `trip-${Date.now()}-${Math.round(Math.random() * 1e6)}${safeExt}`);
  },
});

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WebP, GIF, HEIC) are allowed'));
    }
  },
});

export function createApp(db: DatabaseSync) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use('/uploads', express.static(UPLOADS_DIR));

  // Helper to hydrate trips with catches and images
  function hydrateTrips(rawTrips: Array<Record<string, unknown>>): Trip[] {
    if (rawTrips.length === 0) return [];

    const catchesStmt = db.prepare(
      'SELECT id, trip_id, species, count, length_inches, weight_lbs, fly_or_lure, notes FROM trip_catches WHERE trip_id = ? ORDER BY id ASC'
    );
    const imagesStmt = db.prepare(
      'SELECT id, trip_id, url, caption, created_at FROM trip_images WHERE trip_id = ? ORDER BY id ASC'
    );

    return rawTrips.map((row) => {
      const tripId = Number(row.id);
      const catches = catchesStmt.all(tripId) as unknown as CatchEntry[];
      const images = imagesStmt.all(tripId) as unknown as TripImage[];
      return {
        id: tripId,
        description: String(row.description ?? ''),
        trip_date: String(row.trip_date ?? ''),
        location_id: Number(row.location_id),
        location_name: row.location_name ? String(row.location_name) : undefined,
        location_lat: row.location_lat !== undefined ? Number(row.location_lat) : undefined,
        location_lng: row.location_lng !== undefined ? Number(row.location_lng) : undefined,
        location_water_body: row.location_water_body ? String(row.location_water_body) : undefined,
        location_usgs_site_no: row.location_usgs_site_no
          ? String(row.location_usgs_site_no)
          : undefined,
        score: Number(row.score ?? 0),
        comments: String(row.comments ?? ''),
        rig_type: String(row.rig_type ?? ''),
        hatches: String(row.hatches ?? ''),
        water_clarity: String(row.water_clarity ?? 'Clear'),
        river_flow_cfs: row.river_flow_cfs !== null ? Number(row.river_flow_cfs) : null,
        gauge_height_ft: row.gauge_height_ft !== null ? Number(row.gauge_height_ft) : null,
        water_temp_f: row.water_temp_f !== null ? Number(row.water_temp_f) : null,
        weather_summary: String(row.weather_summary ?? ''),
        air_temp_f: row.air_temp_f !== null ? Number(row.air_temp_f) : null,
        wind_mph: row.wind_mph !== null ? Number(row.wind_mph) : null,
        barometric_pressure:
          row.barometric_pressure !== null ? Number(row.barometric_pressure) : null,
        created_at: String(row.created_at ?? ''),
        catches,
        images,
      };
    });
  }

  // ==================== LOCATIONS ====================

  const LOCATION_SELECT_SQL = `
    SELECT
      l.*,
      COUNT(t.id) AS trip_count,
      ROUND(AVG(t.score), 1) AS avg_score,
      MAX(t.trip_date) AS last_visited
    FROM locations l
    LEFT JOIN trips t ON t.location_id = l.id
  `;

  app.get('/api/locations', (_req, res) => {
    const rows = db
      .prepare(`${LOCATION_SELECT_SQL} GROUP BY l.id ORDER BY l.name ASC`)
      .all() as unknown as Location[];
    res.json(rows);
  });

  app.get('/api/locations/:id', (req, res) => {
    const id = Number(req.params.id);
    const row = db
      .prepare(`${LOCATION_SELECT_SQL} WHERE l.id = ? GROUP BY l.id`)
      .get(id) as unknown as Location | undefined;
    if (!row) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }
    res.json(row);
  });

  app.post('/api/locations', (req, res) => {
    const {
      name,
      latitude,
      longitude,
      water_body = '',
      usgs_site_no = '',
      notes = '',
    } = req.body ?? {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Location name is required' });
      return;
    }
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      res.status(400).json({ error: 'Valid latitude and longitude are required' });
      return;
    }

    const result = db
      .prepare(
        `INSERT INTO locations (name, latitude, longitude, water_body, usgs_site_no, notes)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        name.trim(),
        lat,
        lng,
        String(water_body).trim(),
        String(usgs_site_no).trim(),
        String(notes).trim()
      );

    const created = db
      .prepare(`${LOCATION_SELECT_SQL} WHERE l.id = ? GROUP BY l.id`)
      .get(Number(result.lastInsertRowid)) as unknown as Location;

    res.status(201).json(created);
  });

  app.put('/api/locations/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id FROM locations WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    const {
      name,
      latitude,
      longitude,
      water_body = '',
      usgs_site_no = '',
      notes = '',
    } = req.body ?? {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Location name is required' });
      return;
    }
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      res.status(400).json({ error: 'Valid latitude and longitude are required' });
      return;
    }

    db.prepare(
      `UPDATE locations
       SET name = ?, latitude = ?, longitude = ?, water_body = ?, usgs_site_no = ?, notes = ?
       WHERE id = ?`
    ).run(
      name.trim(),
      lat,
      lng,
      String(water_body).trim(),
      String(usgs_site_no).trim(),
      String(notes).trim(),
      id
    );

    const updated = db
      .prepare(`${LOCATION_SELECT_SQL} WHERE l.id = ? GROUP BY l.id`)
      .get(id) as unknown as Location;

    res.json(updated);
  });

  app.delete('/api/locations/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id FROM locations WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }
    db.prepare('DELETE FROM locations WHERE id = ?').run(id);
    res.json({ deleted: true, id });
  });

  // ==================== TRIPS ====================

  const TRIP_SELECT_SQL = `
    SELECT
      t.*,
      l.name AS location_name,
      l.latitude AS location_lat,
      l.longitude AS location_lng,
      l.water_body AS location_water_body,
      l.usgs_site_no AS location_usgs_site_no
    FROM trips t
    JOIN locations l ON l.id = t.location_id
  `;

  app.get('/api/trips', (req, res) => {
    const { search, location_id, min_score } = req.query;
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (location_id) {
      conditions.push('t.location_id = ?');
      params.push(Number(location_id));
    }

    if (min_score) {
      conditions.push('t.score >= ?');
      params.push(Number(min_score));
    }

    if (search && typeof search === 'string' && search.trim()) {
      const q = `%${search.trim()}%`;
      conditions.push(`(
        t.description LIKE ?
        OR t.comments LIKE ?
        OR t.rig_type LIKE ?
        OR t.hatches LIKE ?
        OR l.name LIKE ?
        OR l.water_body LIKE ?
        OR EXISTS (
          SELECT 1 FROM trip_catches tc
          WHERE tc.trip_id = t.id AND (tc.species LIKE ? OR tc.fly_or_lure LIKE ? OR tc.notes LIKE ?)
        )
      )`);
      params.push(q, q, q, q, q, q, q, q, q);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .prepare(`${TRIP_SELECT_SQL} ${whereClause} ORDER BY t.trip_date DESC, t.id DESC`)
      .all(...params) as Array<Record<string, unknown>>;

    res.json(hydrateTrips(rows));
  });

  app.get('/api/trips/:id', (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare(`${TRIP_SELECT_SQL} WHERE t.id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;

    if (!row) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    res.json(hydrateTrips([row])[0]);
  });

  function saveCatches(tripId: number, catches: unknown) {
    db.prepare('DELETE FROM trip_catches WHERE trip_id = ?').run(tripId);
    if (!Array.isArray(catches)) return;

    const insertCatch = db.prepare(`
      INSERT INTO trip_catches (trip_id, species, count, length_inches, weight_lbs, fly_or_lure, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const c of catches) {
      if (!c || typeof c !== 'object') continue;
      const entry = c as Record<string, unknown>;
      const species = String(entry.species ?? '').trim();
      if (!species) continue;
      const count = Math.max(1, Number(entry.count) || 1);
      const length =
        entry.length_inches !== null &&
        entry.length_inches !== undefined &&
        entry.length_inches !== ''
          ? Number(entry.length_inches)
          : null;
      const weight =
        entry.weight_lbs !== null && entry.weight_lbs !== undefined && entry.weight_lbs !== ''
          ? Number(entry.weight_lbs)
          : null;
      insertCatch.run(
        tripId,
        species,
        count,
        Number.isNaN(length as number) ? null : length,
        Number.isNaN(weight as number) ? null : weight,
        String(entry.fly_or_lure ?? '').trim(),
        String(entry.notes ?? '').trim()
      );
    }
  }

  function parseOptionalNumber(val: unknown): number | null {
    if (val === null || val === undefined || val === '') return null;
    const num = Number(val);
    return Number.isNaN(num) ? null : num;
  }

  app.post('/api/trips', (req, res) => {
    const {
      description,
      trip_date,
      location_id,
      score = 3,
      comments = '',
      rig_type = '',
      hatches = '',
      water_clarity = 'Clear',
      river_flow_cfs = null,
      gauge_height_ft = null,
      water_temp_f = null,
      weather_summary = '',
      air_temp_f = null,
      wind_mph = null,
      barometric_pressure = null,
      catches = [],
    } = req.body ?? {};

    if (!description || typeof description !== 'string' || !description.trim()) {
      res.status(400).json({ error: 'Trip description is required' });
      return;
    }
    if (!trip_date || typeof trip_date !== 'string') {
      res.status(400).json({ error: 'Trip date is required' });
      return;
    }
    const locId = Number(location_id);
    const locExists = db.prepare('SELECT id FROM locations WHERE id = ?').get(locId);
    if (!locExists) {
      res.status(400).json({ error: 'Valid location is required' });
      return;
    }

    const boundedScore = Math.min(5, Math.max(0, Math.round(Number(score) || 0)));

    const result = db
      .prepare(
        `INSERT INTO trips (
          description, trip_date, location_id, score, comments,
          rig_type, hatches, water_clarity,
          river_flow_cfs, gauge_height_ft, water_temp_f,
          weather_summary, air_temp_f, wind_mph, barometric_pressure
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        description.trim(),
        trip_date.trim(),
        locId,
        boundedScore,
        String(comments).trim(),
        String(rig_type).trim(),
        String(hatches).trim(),
        String(water_clarity || 'Clear').trim(),
        parseOptionalNumber(river_flow_cfs),
        parseOptionalNumber(gauge_height_ft),
        parseOptionalNumber(water_temp_f),
        String(weather_summary).trim(),
        parseOptionalNumber(air_temp_f),
        parseOptionalNumber(wind_mph),
        parseOptionalNumber(barometric_pressure)
      );

    const tripId = Number(result.lastInsertRowid);
    saveCatches(tripId, catches);

    const createdRow = db
      .prepare(`${TRIP_SELECT_SQL} WHERE t.id = ?`)
      .get(tripId) as Record<string, unknown>;

    res.status(201).json(hydrateTrips([createdRow])[0]);
  });

  app.put('/api/trips/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id FROM trips WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    const {
      description,
      trip_date,
      location_id,
      score = 3,
      comments = '',
      rig_type = '',
      hatches = '',
      water_clarity = 'Clear',
      river_flow_cfs = null,
      gauge_height_ft = null,
      water_temp_f = null,
      weather_summary = '',
      air_temp_f = null,
      wind_mph = null,
      barometric_pressure = null,
      catches,
    } = req.body ?? {};

    if (!description || typeof description !== 'string' || !description.trim()) {
      res.status(400).json({ error: 'Trip description is required' });
      return;
    }
    if (!trip_date || typeof trip_date !== 'string') {
      res.status(400).json({ error: 'Trip date is required' });
      return;
    }
    const locId = Number(location_id);
    const locExists = db.prepare('SELECT id FROM locations WHERE id = ?').get(locId);
    if (!locExists) {
      res.status(400).json({ error: 'Valid location is required' });
      return;
    }

    const boundedScore = Math.min(5, Math.max(0, Math.round(Number(score) || 0)));

    db.prepare(
      `UPDATE trips SET
        description = ?, trip_date = ?, location_id = ?, score = ?, comments = ?,
        rig_type = ?, hatches = ?, water_clarity = ?,
        river_flow_cfs = ?, gauge_height_ft = ?, water_temp_f = ?,
        weather_summary = ?, air_temp_f = ?, wind_mph = ?, barometric_pressure = ?
       WHERE id = ?`
    ).run(
      description.trim(),
      trip_date.trim(),
      locId,
      boundedScore,
      String(comments).trim(),
      String(rig_type).trim(),
      String(hatches).trim(),
      String(water_clarity || 'Clear').trim(),
      parseOptionalNumber(river_flow_cfs),
      parseOptionalNumber(gauge_height_ft),
      parseOptionalNumber(water_temp_f),
      String(weather_summary).trim(),
      parseOptionalNumber(air_temp_f),
      parseOptionalNumber(wind_mph),
      parseOptionalNumber(barometric_pressure),
      id
    );

    if (catches !== undefined) {
      saveCatches(id, catches);
    }

    const updatedRow = db
      .prepare(`${TRIP_SELECT_SQL} WHERE t.id = ?`)
      .get(id) as Record<string, unknown>;

    res.json(hydrateTrips([updatedRow])[0]);
  });

  app.delete('/api/trips/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id FROM trips WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    const images = db
      .prepare('SELECT url FROM trip_images WHERE trip_id = ?')
      .all(id) as unknown as Array<{ url: string }>;
    for (const img of images) {
      if (img.url.startsWith('/uploads/')) {
        const filePath = path.join(UPLOADS_DIR, path.basename(img.url));
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch {
            // ignore unlink error
          }
        }
      }
    }

    db.prepare('DELETE FROM trips WHERE id = ?').run(id);
    res.json({ deleted: true, id });
  });

  // ==================== TRIP IMAGES ====================

  app.post('/api/trips/:id/images', upload.array('images', 10), (req, res) => {
    const tripId = Number(req.params.id);
    const existing = db.prepare('SELECT id FROM trips WHERE id = ?').get(tripId);
    if (!existing) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    const files = (req.files as Express.Multer.File[]) ?? [];
    const caption = String(req.body?.caption ?? '').trim();
    const insertStmt = db.prepare(
      'INSERT INTO trip_images (trip_id, url, caption) VALUES (?, ?, ?)'
    );

    const added: TripImage[] = [];
    for (const file of files) {
      const url = `/uploads/${file.filename}`;
      const resInsert = insertStmt.run(tripId, url, caption);
      const row = db
        .prepare('SELECT id, trip_id, url, caption, created_at FROM trip_images WHERE id = ?')
        .get(Number(resInsert.lastInsertRowid)) as unknown as TripImage;
      added.push(row);
    }

    res.status(201).json(added);
  });

  app.delete('/api/trips/:tripId/images/:imageId', (req, res) => {
    const tripId = Number(req.params.tripId);
    const imageId = Number(req.params.imageId);
    const img = db
      .prepare('SELECT id, url FROM trip_images WHERE id = ? AND trip_id = ?')
      .get(imageId, tripId) as { id: number; url: string } | undefined;

    if (!img) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    if (img.url.startsWith('/uploads/')) {
      const filePath = path.join(UPLOADS_DIR, path.basename(img.url));
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore
        }
      }
    }

    db.prepare('DELETE FROM trip_images WHERE id = ?').run(imageId);
    res.json({ deleted: true, id: imageId });
  });

  // ==================== USGS & WEATHER SERVICES ====================

  app.get('/api/usgs/truckee-flows', async (_req, res) => {
    const gauges = await fetchTruckeeWatershedFlows();
    res.json(gauges);
  });

  app.get('/api/usgs/nearby', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      res.status(400).json({ error: 'Valid lat and lng query parameters are required' });
      return;
    }
    const gauges = await findNearbyUsgsGauges(lat, lng);
    res.json(gauges);
  });

  app.get('/api/usgs/site/:siteNo', async (req, res) => {
    const siteNo = req.params.siteNo;
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const info = await fetchUsgsSiteData(siteNo, date);
    if (!info) {
      res.status(404).json({ error: 'No USGS data found for this site' });
      return;
    }
    res.json(info);
  });

  app.get('/api/conditions/lookup', async (req, res) => {
    const locationId = req.query.locationId ? Number(req.query.locationId) : null;
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;

    let lat = req.query.lat ? Number(req.query.lat) : NaN;
    let lng = req.query.lng ? Number(req.query.lng) : NaN;
    let usgsSiteNo = typeof req.query.usgsSiteNo === 'string' ? req.query.usgsSiteNo : '';

    if (locationId) {
      const loc = db
        .prepare('SELECT latitude, longitude, usgs_site_no FROM locations WHERE id = ?')
        .get(locationId) as
        | { latitude: number; longitude: number; usgs_site_no: string }
        | undefined;
      if (loc) {
        lat = loc.latitude;
        lng = loc.longitude;
        if (!usgsSiteNo && loc.usgs_site_no) {
          usgsSiteNo = loc.usgs_site_no;
        }
      }
    }

    const [usgsResult, weatherResult] = await Promise.all([
      usgsSiteNo ? fetchUsgsSiteData(usgsSiteNo, date) : Promise.resolve(null),
      !Number.isNaN(lat) && !Number.isNaN(lng)
        ? fetchWeatherConditions(lat, lng, date)
        : Promise.resolve(null),
    ]);

    res.json({
      usgs: usgsResult
        ? {
            siteNo: usgsResult.siteNo,
            siteName: usgsResult.siteName,
            flowCfs: usgsResult.flowCfs,
            gaugeHeightFt: usgsResult.gaugeHeightFt,
            waterTempF: usgsResult.waterTempF,
            observedAt: usgsResult.observedAt,
          }
        : null,
      weather: weatherResult,
    });
  });

  // Serve built frontend in production
  const distPath = path.resolve(__dirname, '../dist');
  if (process.env.NODE_ENV === 'production' && fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}
