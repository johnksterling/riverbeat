# RiverBeat

A modern full-stack TypeScript fly-fishing journal, river beat directory, and live/historical USGS stream gauge tracker — pre-configured for the **Truckee River & Little Truckee watershed** and surrounding Sierra waters.

## Features

- **Live Watershed USGS Flow Dashboard**: Real-time discharge (CFS), gauge height (ft), water temperature (°F), and prime wadeable flow ranges across the 6 key Truckee & Little Truckee USGS gauges (`10337500` Tahoe City, `10338000` Near Truckee, `10344400` Little Truckee above Boca, `10344505` Boca Bridge / Hirschdale, `10346000` Farad Canyon, and `10348000` Reno).
- **Fly-Fishing Session Journal**:
  - Track your **Primary Rig / Technique** (*Euro / Tight-Line Nymphing*, *Indicator Nymphing*, *Dry-Dropper*, *Technical Dry Fly*, *Streamer*, *Swinging Soft Hackles*).
  - Record **Active Hatches Observed** (*BWO / Baetis*, *PMD*, *Golden Stones*, *Skwala*, *Green Drakes*, *Spotted Sedge Caddis*, *October Caddis*, *Crayfish / Sculpin*, *Midges*, *Terrestrials*).
  - Track **Water Clarity** and automatic **Hoot Owl Thermal Stress Alerts** when water temperatures reach **≥ 67°F**.
  - One-click **Auto-Fill from USGS & Weather** (historical/live USGS flow, gauge height, water temp, plus Open-Meteo sky condition, air temp, wind speed, and barometric pressure in inHg).
- **Trout & Fly Pattern Logging**: Record species, count, max length (in), weight (lbs), and winning fly pattern per session, plus upload session photos.
- **USGS Topo & Satellite Map Explorer**: Interactive Leaflet map with **USGS Topo**, **USGS Satellite + Topo**, and **OpenStreetMap** layers (no API keys required), plus dynamic nearby USGS stream gauge discovery.
- **Local-First SQLite Storage**: Uses Node's built-in `node:sqlite` (`data/riverbeat.db`) and local photo storage (`data/uploads/`).

## Getting Started

> **Prerequisites**: Node.js 22.5+ (for built-in `node:sqlite`).

```bash
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

## Scripts

- `npm run dev` — Start both the Express API server (`http://localhost:3001`) and Vite frontend (`http://localhost:5173`)
- `npm test` — Run API and SQLite test suite via Vitest
- `npm run build` — Run strict TypeScript check (`tsc -b`) and build the production bundle (`dist/`)
- `npm start` — Run the production server on `http://localhost:3001`
