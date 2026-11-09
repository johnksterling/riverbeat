import type { ConditionsLookupResult, USGSGaugeInfo } from '../../shared/types.ts';

const WMO_CODES: Record<number, string> = {
  0: 'Clear Sky',
  1: 'Mainly Clear',
  2: 'Partly Cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Rime Fog',
  51: 'Light Drizzle',
  53: 'Moderate Drizzle',
  55: 'Dense Drizzle',
  61: 'Light Rain',
  63: 'Moderate Rain',
  65: 'Heavy Rain',
  71: 'Light Snow',
  73: 'Moderate Snow',
  75: 'Heavy Snow',
  80: 'Rain Showers',
  81: 'Moderate Showers',
  82: 'Heavy Showers',
  95: 'Thunderstorm',
};

export const TRUCKEE_WATERSHED_GAUGES: Array<{
  siteNo: string;
  shortLabel: string;
  idealFlowRange: string;
  defaultLat: number;
  defaultLng: number;
}> = [
  {
    siteNo: '10337500',
    shortLabel: 'Tahoe City (Dam)',
    idealFlowRange: '70–300 CFS',
    defaultLat: 39.166,
    defaultLng: -120.1438,
  },
  {
    siteNo: '10338000',
    shortLabel: 'Near Truckee (Hwy 89)',
    idealFlowRange: '100–450 CFS',
    defaultLat: 39.2957,
    defaultLng: -120.2035,
  },
  {
    siteNo: '10344400',
    shortLabel: 'Little Truckee (Boca)',
    idealFlowRange: '60–225 CFS',
    defaultLat: 39.4427,
    defaultLng: -120.0835,
  },
  {
    siteNo: '10344505',
    shortLabel: 'Boca Bridge / Hirschdale',
    idealFlowRange: '250–700 CFS',
    defaultLat: 39.3871,
    defaultLng: -120.0955,
  },
  {
    siteNo: '10346000',
    shortLabel: 'Farad (CA/NV Canyon)',
    idealFlowRange: '300–800 CFS',
    defaultLat: 39.4285,
    defaultLng: -120.0332,
  },
  {
    siteNo: '10348000',
    shortLabel: 'Reno, NV',
    idealFlowRange: '300–850 CFS',
    defaultLat: 39.5313,
    defaultLng: -119.7849,
  },
];

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

interface UsgsTimeSeries {
  sourceInfo?: {
    siteName?: string;
    siteCode?: Array<{ value?: string }>;
    geoLocation?: {
      geogLocation?: {
        latitude?: number;
        longitude?: number;
      };
    };
  };
  variable?: {
    variableCode?: Array<{ value?: string }>;
  };
  values?: Array<{
    value?: Array<{
      value?: string;
      dateTime?: string;
    }>;
  }>;
}

function parseUsgsTimeSeries(timeSeries: UsgsTimeSeries[]): Map<string, USGSGaugeInfo> {
  const sites = new Map<string, USGSGaugeInfo>();

  for (const series of timeSeries) {
    const siteNo = series.sourceInfo?.siteCode?.[0]?.value;
    if (!siteNo) continue;

    const siteName = series.sourceInfo?.siteName ?? `USGS Site ${siteNo}`;
    const lat = Number(series.sourceInfo?.geoLocation?.geogLocation?.latitude ?? 0);
    const lng = Number(series.sourceInfo?.geoLocation?.geogLocation?.longitude ?? 0);

    if (!sites.has(siteNo)) {
      sites.set(siteNo, {
        siteNo,
        siteName,
        latitude: lat,
        longitude: lng,
        flowCfs: null,
        gaugeHeightFt: null,
        waterTempF: null,
        observedAt: null,
      });
    }

    const entry = sites.get(siteNo)!;
    const paramCode = series.variable?.variableCode?.[0]?.value;
    const rawValues = series.values?.[0]?.value ?? [];
    for (let i = rawValues.length - 1; i >= 0; i--) {
      const numVal = Number(rawValues[i]?.value);
      if (!Number.isNaN(numVal) && numVal > -99999) {
        if (paramCode === '00060') {
          entry.flowCfs = Math.round(numVal * 10) / 10;
        } else if (paramCode === '00065') {
          entry.gaugeHeightFt = Math.round(numVal * 100) / 100;
        } else if (paramCode === '00010') {
          entry.waterTempF = Math.round(((numVal * 9) / 5 + 32) * 10) / 10;
        }
        if (rawValues[i]?.dateTime) {
          entry.observedAt = rawValues[i].dateTime!;
        }
        break;
      }
    }
  }

  return sites;
}

/**
 * Fetches live Truckee River watershed gauges in a single batch call.
 */
export async function fetchTruckeeWatershedFlows(): Promise<USGSGaugeInfo[]> {
  const siteNos = TRUCKEE_WATERSHED_GAUGES.map((g) => g.siteNo).join(',');
  const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${siteNos}&parameterCd=00060,00065,00010&siteStatus=all`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('USGS error');
    const data = (await res.json()) as { value?: { timeSeries?: UsgsTimeSeries[] } };
    const parsed = parseUsgsTimeSeries(data?.value?.timeSeries ?? []);

    return TRUCKEE_WATERSHED_GAUGES.map((preset) => {
      const live = parsed.get(preset.siteNo);
      return {
        siteNo: preset.siteNo,
        siteName: live?.siteName ?? preset.shortLabel,
        shortLabel: preset.shortLabel,
        idealFlowRange: preset.idealFlowRange,
        latitude: live?.latitude || preset.defaultLat,
        longitude: live?.longitude || preset.defaultLng,
        flowCfs: live?.flowCfs ?? null,
        gaugeHeightFt: live?.gaugeHeightFt ?? null,
        waterTempF: live?.waterTempF ?? null,
        observedAt: live?.observedAt ?? null,
      };
    });
  } catch {
    return TRUCKEE_WATERSHED_GAUGES.map((preset) => ({
      siteNo: preset.siteNo,
      siteName: preset.shortLabel,
      shortLabel: preset.shortLabel,
      idealFlowRange: preset.idealFlowRange,
      latitude: preset.defaultLat,
      longitude: preset.defaultLng,
      flowCfs: null,
      gaugeHeightFt: null,
      waterTempF: null,
      observedAt: null,
    }));
  }
}

/**
 * Fetches USGS river data (Discharge 00060, Gage Height 00065, Water Temp 00010)
 * for a given USGS site number and optional trip date/time.
 */
export async function fetchUsgsSiteData(
  siteNo: string,
  tripDateIso?: string
): Promise<USGSGaugeInfo | null> {
  const cleanSite = siteNo.trim();
  if (!cleanSite) return null;

  try {
    let url: string;
    if (tripDateIso) {
      const dateStr = tripDateIso.slice(0, 10);
      const parsedDate = new Date(tripDateIso);
      const now = new Date();
      const diffDays = (now.getTime() - parsedDate.getTime()) / (1000 * 3600 * 24);

      if (!Number.isNaN(diffDays) && diffDays >= 0 && diffDays <= 110) {
        url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${encodeURIComponent(
          cleanSite
        )}&startDT=${dateStr}T00:00&endDT=${dateStr}T23:59&parameterCd=00060,00065,00010&siteStatus=all`;
      } else if (!Number.isNaN(diffDays) && diffDays > 110) {
        url = `https://waterservices.usgs.gov/nwis/dv/?format=json&sites=${encodeURIComponent(
          cleanSite
        )}&startDT=${dateStr}&endDT=${dateStr}&parameterCd=00060,00065,00010&siteStatus=all`;
      } else {
        url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${encodeURIComponent(
          cleanSite
        )}&parameterCd=00060,00065,00010&siteStatus=all`;
      }
    } else {
      url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${encodeURIComponent(
        cleanSite
      )}&parameterCd=00060,00065,00010&siteStatus=all`;
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { value?: { timeSeries?: UsgsTimeSeries[] } };
    const ts = data?.value?.timeSeries ?? [];
    const parsed = parseUsgsTimeSeries(ts);
    const result = parsed.get(cleanSite);

    if (!result && tripDateIso) {
      return fetchUsgsSiteData(cleanSite);
    }

    return result ?? null;
  } catch {
    return null;
  }
}

/**
 * Finds active USGS stream gauges within a bounding box around (latitude, longitude).
 */
export async function findNearbyUsgsGauges(
  latitude: number,
  longitude: number,
  deltaDegrees = 0.35
): Promise<USGSGaugeInfo[]> {
  const west = (longitude - deltaDegrees).toFixed(4);
  const south = (latitude - deltaDegrees).toFixed(4);
  const east = (longitude + deltaDegrees).toFixed(4);
  const north = (latitude + deltaDegrees).toFixed(4);

  const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${west},${south},${east},${north}&parameterCd=00060,00065,00010&siteType=ST&siteStatus=active`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { value?: { timeSeries?: UsgsTimeSeries[] } };
    const ts = data?.value?.timeSeries ?? [];
    const sitesMap = parseUsgsTimeSeries(ts);

    const results = Array.from(sitesMap.values()).map((site) => ({
      ...site,
      distanceMiles:
        Math.round(haversineMiles(latitude, longitude, site.latitude, site.longitude) * 10) / 10,
    }));

    results.sort((a, b) => (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999));
    return results.slice(0, 12);
  } catch {
    return [];
  }
}

/**
 * Fetches weather conditions (temperature, wind, pressure, sky condition)
 * from Open-Meteo for the given coordinates and date.
 */
export async function fetchWeatherConditions(
  latitude: number,
  longitude: number,
  tripDateIso?: string
): Promise<ConditionsLookupResult['weather']> {
  try {
    const datePart = tripDateIso ? tripDateIso.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const hourPart =
      tripDateIso && tripDateIso.includes('T')
        ? Number(tripDateIso.split('T')[1]?.slice(0, 2) ?? 12)
        : 12;

    const targetDate = new Date(datePart);
    const now = new Date();
    const diffDays = (now.getTime() - targetDate.getTime()) / (1000 * 3600 * 24);

    const baseHost =
      !Number.isNaN(diffDays) && diffDays > 5
        ? 'https://archive-api.open-meteo.com/v1/archive'
        : 'https://api.open-meteo.com/v1/forecast';

    const url = `${baseHost}?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(
      4
    )}&start_date=${datePart}&end_date=${datePart}&hourly=temperature_2m,weather_code,wind_speed_10m,surface_pressure&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;

    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      hourly?: {
        temperature_2m?: Array<number | null>;
        weather_code?: Array<number | null>;
        wind_speed_10m?: Array<number | null>;
        surface_pressure?: Array<number | null>;
      };
    };

    const idx = Math.min(Math.max(0, Number.isNaN(hourPart) ? 12 : hourPart), 23);
    const temp = data.hourly?.temperature_2m?.[idx] ?? null;
    const code = data.hourly?.weather_code?.[idx] ?? null;
    const wind = data.hourly?.wind_speed_10m?.[idx] ?? null;
    const pressureHpa = data.hourly?.surface_pressure?.[idx] ?? null;

    const pressureInHg =
      pressureHpa !== null ? Math.round(pressureHpa * 0.02953 * 100) / 100 : null;

    return {
      summary: code !== null ? WMO_CODES[code] ?? 'Variable Clouds' : 'Fair',
      airTempF: temp !== null ? Math.round(temp * 10) / 10 : null,
      windMph: wind !== null ? Math.round(wind * 10) / 10 : null,
      barometricPressureInHg: pressureInHg,
    };
  } catch {
    return null;
  }
}
