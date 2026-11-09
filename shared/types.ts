export interface Location {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  water_body: string;
  usgs_site_no: string;
  notes: string;
  created_at: string;
  trip_count?: number;
  avg_score?: number | null;
  last_visited?: string | null;
}

export interface CatchEntry {
  id?: number;
  trip_id?: number;
  species: string;
  count: number;
  length_inches: number | null;
  weight_lbs: number | null;
  fly_or_lure: string;
  notes: string;
}

export interface TripImage {
  id: number;
  trip_id: number;
  url: string;
  caption: string;
  created_at: string;
}

export interface Trip {
  id: number;
  description: string;
  trip_date: string; // ISO date or datetime string YYYY-MM-DDTHH:mm
  location_id: number;
  location_name?: string;
  location_lat?: number;
  location_lng?: number;
  location_water_body?: string;
  location_usgs_site_no?: string;
  score: number; // 1 to 5 stars
  comments: string;
  rig_type: string; // e.g., Euro Nymphing, Indicator, Dry Fly, Dry-Dropper, Streamer
  hatches: string; // e.g., BWO, PMD, Golden Stones, Green Drakes, Caddis
  water_clarity: string; // e.g., Clear, Slightly Off-Color, Glacial Tint, High/Muddy
  river_flow_cfs: number | null;
  gauge_height_ft: number | null;
  water_temp_f: number | null;
  weather_summary: string;
  air_temp_f: number | null;
  wind_mph: number | null;
  barometric_pressure: number | null;
  created_at: string;
  catches: CatchEntry[];
  images: TripImage[];
}

export interface USGSGaugeInfo {
  siteNo: string;
  siteName: string;
  shortLabel?: string;
  idealFlowRange?: string;
  latitude: number;
  longitude: number;
  distanceMiles?: number;
  flowCfs: number | null;
  gaugeHeightFt: number | null;
  waterTempF: number | null;
  observedAt: string | null;
}

export interface ConditionsLookupResult {
  usgs: {
    siteNo: string | null;
    siteName: string | null;
    flowCfs: number | null;
    gaugeHeightFt: number | null;
    waterTempF: number | null;
    observedAt: string | null;
  } | null;
  weather: {
    summary: string;
    airTempF: number | null;
    windMph: number | null;
    barometricPressureInHg: number | null;
  } | null;
}
