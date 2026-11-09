import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(__dirname, '../data');
export const UPLOADS_DIR = path.resolve(DATA_DIR, 'uploads');

export function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

export function initDatabase(dbPath?: string): DatabaseSync {
  ensureDirectories();
  const resolvedPath = dbPath ?? path.resolve(DATA_DIR, 'riverbeat.db');
  const db = new DatabaseSync(resolvedPath);

  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      water_body TEXT NOT NULL DEFAULT '',
      usgs_site_no TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      trip_date TEXT NOT NULL,
      location_id INTEGER NOT NULL,
      score INTEGER NOT NULL DEFAULT 3,
      comments TEXT NOT NULL DEFAULT '',
      rig_type TEXT NOT NULL DEFAULT '',
      hatches TEXT NOT NULL DEFAULT '',
      water_clarity TEXT NOT NULL DEFAULT 'Clear',
      river_flow_cfs REAL,
      gauge_height_ft REAL,
      water_temp_f REAL,
      weather_summary TEXT NOT NULL DEFAULT '',
      air_temp_f REAL,
      wind_mph REAL,
      barometric_pressure REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS trip_catches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      species TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      length_inches REAL,
      weight_lbs REAL,
      fly_or_lure TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS trip_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    );
  `);

  // Safe schema migrations for existing SQLite files
  const tripCols = db.prepare("PRAGMA table_info('trips')").all() as Array<{ name: string }>;
  const colNames = new Set(tripCols.map((c) => c.name));
  if (!colNames.has('rig_type')) {
    db.exec("ALTER TABLE trips ADD COLUMN rig_type TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.has('hatches')) {
    db.exec("ALTER TABLE trips ADD COLUMN hatches TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.has('water_clarity')) {
    db.exec("ALTER TABLE trips ADD COLUMN water_clarity TEXT NOT NULL DEFAULT 'Clear'");
  }

  if (resolvedPath !== ':memory:') {
    const countRow = db.prepare('SELECT COUNT(*) as count FROM locations').get() as {
      count: number;
    };
    if (countRow.count === 0) {
      seedTruckeeData(db);
    }
  }

  return db;
}

export function seedTruckeeData(db: DatabaseSync) {
  const insertLocation = db.prepare(`
    INSERT INTO locations (name, latitude, longitude, water_body, usgs_site_no, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const glenshire = insertLocation.run(
    'Glenshire Bridge & Canyon Runs',
    39.3452,
    -120.118,
    'Truckee River',
    '10338000',
    'Classic pocket water, riffles, and boulder buckets above Boca confluence. Prime Euro-nymphing and summer caddis/stonefly water. Ideal flows: 150–450 CFS.'
  );

  const hirschdale = insertLocation.run(
    'Hirschdale & Boca Confluence',
    39.3871,
    -120.0955,
    'Truckee River',
    '10344505',
    'Cold tailwater influx from the Little Truckee meets the mainstem. Deep runs and heavy riffles holding large browns and wild rainbows. Best wadeable flows: 250–650 CFS.'
  );

  const farad = insertLocation.run(
    'Farad / Floriston Canyon',
    39.4285,
    -120.0332,
    'Truckee River',
    '10346000',
    'Big canyon water near the CA/NV border. Heavy boulder pockets, deep green slots, and prime streamer/crayfish water for trophy browns. Ideal flows: 300–750 CFS.'
  );

  const littleTruckee = insertLocation.run(
    'Little Truckee - Boyington Mill Tailwater',
    39.4427,
    -120.0835,
    'Little Truckee River',
    '10344400',
    'Technical spring-creek style tailwater between Stampede and Boca Reservoirs. 6X–7X fluorocarbon, #18–22 Baetis, PMDs, Green Drakes, and midges. Ideal flows: 60–200 CFS.'
  );

  const hwy89 = insertLocation.run(
    'Highway 89 Canyon - Cabin Creek',
    39.2725,
    -120.2078,
    'Truckee River',
    '10338000',
    'Upper river meadow-to-pocket transitions between Tahoe City and Town of Truckee. Great dry-dropper and hopper water in summer. Ideal flows: 90–350 CFS.'
  );

  const insertTrip = db.prepare(`
    INSERT INTO trips (
      description, trip_date, location_id, score, comments,
      rig_type, hatches, water_clarity,
      river_flow_cfs, gauge_height_ft, water_temp_f,
      weather_summary, air_temp_f, wind_mph, barometric_pressure
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const trip1 = insertTrip.run(
    'Tight-Line Nymphing Pocket Water below Boca Bridge',
    '2026-06-18T07:30',
    Number(hirschdale.lastInsertRowid),
    5,
    'Cold water pushing out of the Little Truckee kept temps prime all morning. Focused on walking-speed riffles and waist-deep boulder seams with a two-fly Euro rig. Fish were stacked in the soft cushions behind mid-river boulders.',
    'Euro / Tight-Line Nymphing',
    'PMD, Golden Stones, Caddis',
    'Clear',
    465,
    3.92,
    55,
    'Mainly Clear',
    66,
    5,
    30.04
  );

  const trip2 = insertTrip.run(
    'Overcast BWO & Streamer Session in Farad Canyon',
    '2026-10-14T11:00',
    Number(farad.lastInsertRowid),
    5,
    'Low pressure front rolled through the canyon around noon triggering a solid fall Baetis hatch. Fished articulated sculpin and crayfish patterns on a sink-tip through the deep green troughs first, then switched to small Baetis nymphs in the tailouts.',
    'Streamer & Euro Nymphing',
    'BWO (Baetis), October Caddis, Crayfish',
    'Slightly Off-Color',
    390,
    4.18,
    51,
    'Overcast',
    54,
    9,
    29.82
  );

  const trip3 = insertTrip.run(
    'Technical Dry Fly Session on the Little Truckee',
    '2026-07-09T09:00',
    Number(littleTruckee.lastInsertRowid),
    4,
    'Steady morning PMD and Green Drake spinner fall in the meadow glides. Needed long 13ft leaders with 6X tippet and drag-free downstream reach casts to fool the selective fish holding against the undercut bank.',
    'Dry Fly',
    'PMD, Green Drakes, Midges',
    'Crystal Clear',
    135,
    2.45,
    53,
    'Clear Sky',
    72,
    4,
    30.1
  );

  const trip4 = insertTrip.run(
    'Summer Evening Caddis & Hopper-Dropper at Glenshire',
    '2026-08-03T17:00',
    Number(glenshire.lastInsertRowid),
    4,
    'Checked water temp before fishing (61°F in the shaded canyon). Fished a foam Chubby Chernobyl with a #16 Tungsten Surveyor dropper through the fast oxygenated runs until sunset caddis flight.',
    'Dry-Dropper',
    'Spotted Sedge Caddis, Terrestrials',
    'Clear',
    240,
    3.15,
    61,
    'Partly Cloudy',
    76,
    7,
    29.96
  );

  // Unused variable warning prevention while keeping Highway 89 spot available
  void hwy89;

  const insertCatch = db.prepare(`
    INSERT INTO trip_catches (trip_id, species, count, length_inches, weight_lbs, fly_or_lure, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertCatch.run(
    Number(trip1.lastInsertRowid),
    'Wild Rainbow Trout',
    5,
    18.5,
    2.6,
    '#8 Pat\'s Rubber Legs (Brown/Olive)',
    'Hot-wired Truckee redband, took me into the backing in the main current'
  );
  insertCatch.run(
    Number(trip1.lastInsertRowid),
    'Brown Trout',
    2,
    17.0,
    2.1,
    '#16 Olive Perdigon (Dropper)',
    'Holding tight to the bottom of the drop-off'
  );
  insertCatch.run(
    Number(trip2.lastInsertRowid),
    'Brown Trout',
    2,
    22.5,
    4.2,
    '#6 Olive Sculpzilla / Crayfish',
    'Heavy kype-jawed canyon brown ambushed the streamer off a submerged ledge'
  );
  insertCatch.run(
    Number(trip2.lastInsertRowid),
    'Wild Rainbow Trout',
    3,
    16.0,
    1.8,
    '#18 Juju Baetis',
    'Picked up in the slower foam line during the afternoon BWO emergence'
  );
  insertCatch.run(
    Number(trip3.lastInsertRowid),
    'Wild Rainbow Trout',
    4,
    16.5,
    1.9,
    '#16 PMD Sparkle Dun',
    'Sipping emergers along the grassy undercut bank'
  );
  insertCatch.run(
    Number(trip3.lastInsertRowid),
    'Mountain Whitefish',
    2,
    14.5,
    1.2,
    '#20 Black Zebra Midge',
    'Deep tailout run'
  );
  insertCatch.run(
    Number(trip4.lastInsertRowid),
    'Wild Rainbow Trout',
    4,
    15.5,
    1.6,
    '#14 Elk Hair Caddis / #16 Pheasant Tail',
    'Explosive rises in the choppy pocket water at dusk'
  );
}
