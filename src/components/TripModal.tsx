import React, { useState } from 'react';
import {
  AlertTriangle,
  Bug,
  Camera,
  Fish,
  Loader2,
  MapPin,
  Plus,
  Sparkles,
  Trash2,
  Waves,
  X,
} from 'lucide-react';
import type { CatchEntry, Location, Trip, TripImage } from '../../shared/types.ts';
import { api, getAuthenticatedMediaUrl } from '../api.ts';
import { StarRating } from './StarRating.tsx';

const TRUCKEE_RIG_TYPES = [
  'Euro / Tight-Line Nymphing',
  'Indicator Nymphing',
  'Dry-Dropper',
  'Dry Fly (Technical)',
  'Streamer (Sink-Tip / Strip)',
  'Euro + Streamer Combo',
  'Swinging Soft Hackles',
];

const TRUCKEE_HATCHES = [
  'BWO (Baetis)',
  'PMD',
  'Golden Stones',
  'Skwala Stoneflies',
  'Green Drakes',
  'Spotted Sedge Caddis',
  'October Caddis',
  'Crayfish / Sculpin',
  'Midges',
  'Hoppers / Ants / Beetles',
];

const WATER_CLARITY_OPTIONS = [
  'Crystal Clear',
  'Clear',
  'Slightly Off-Color (Green Tint)',
  'Snowmelt / Glacial Tint',
  'High & Off-Color',
];

interface TripModalProps {
  initialTrip?: Trip | null;
  locations: Location[];
  preselectedLocationId?: number | null;
  onClose: () => void;
  onSaved: (trip: Trip) => void;
  onRequestNewLocation: () => void;
}

function defaultDateTimeLocal(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
}

export const TripModal: React.FC<TripModalProps> = ({
  initialTrip,
  locations,
  preselectedLocationId,
  onClose,
  onSaved,
  onRequestNewLocation,
}) => {
  const [description, setDescription] = useState(initialTrip?.description ?? '');
  const [tripDate, setTripDate] = useState(
    initialTrip?.trip_date ? initialTrip.trip_date.slice(0, 16) : defaultDateTimeLocal()
  );
  const [locationId, setLocationId] = useState<number>(
    initialTrip?.location_id ?? preselectedLocationId ?? locations[0]?.id ?? 0
  );
  const [score, setScore] = useState<number>(initialTrip?.score ?? 4);
  const [comments, setComments] = useState(initialTrip?.comments ?? '');

  // Fly fishing specific fields
  const [rigType, setRigType] = useState(initialTrip?.rig_type ?? 'Euro / Tight-Line Nymphing');
  const [hatches, setHatches] = useState(initialTrip?.hatches ?? '');
  const [waterClarity, setWaterClarity] = useState(initialTrip?.water_clarity ?? 'Clear');

  // River & Weather conditions
  const [riverFlowCfs, setRiverFlowCfs] = useState<string>(
    initialTrip?.river_flow_cfs !== null && initialTrip?.river_flow_cfs !== undefined
      ? String(initialTrip.river_flow_cfs)
      : ''
  );
  const [gaugeHeightFt, setGaugeHeightFt] = useState<string>(
    initialTrip?.gauge_height_ft !== null && initialTrip?.gauge_height_ft !== undefined
      ? String(initialTrip.gauge_height_ft)
      : ''
  );
  const [waterTempF, setWaterTempF] = useState<string>(
    initialTrip?.water_temp_f !== null && initialTrip?.water_temp_f !== undefined
      ? String(initialTrip.water_temp_f)
      : ''
  );
  const [weatherSummary, setWeatherSummary] = useState(initialTrip?.weather_summary ?? '');
  const [airTempF, setAirTempF] = useState<string>(
    initialTrip?.air_temp_f !== null && initialTrip?.air_temp_f !== undefined
      ? String(initialTrip.air_temp_f)
      : ''
  );
  const [windMph, setWindMph] = useState<string>(
    initialTrip?.wind_mph !== null && initialTrip?.wind_mph !== undefined
      ? String(initialTrip.wind_mph)
      : ''
  );
  const [barometricPressure, setBarometricPressure] = useState<string>(
    initialTrip?.barometric_pressure !== null && initialTrip?.barometric_pressure !== undefined
      ? String(initialTrip.barometric_pressure)
      : ''
  );

  // Catches
  const [catches, setCatches] = useState<CatchEntry[]>(
    initialTrip?.catches && initialTrip.catches.length > 0 ? initialTrip.catches : []
  );

  // Photos
  const [existingImages, setExistingImages] = useState<TripImage[]>(initialTrip?.images ?? []);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const [fetchingConditions, setFetchingConditions] = useState(false);
  const [conditionsStatus, setConditionsStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedLocation = locations.find((l) => l.id === Number(locationId));
  const numericWaterTemp = waterTempF !== '' ? Number(waterTempF) : null;
  const isHootOwlTemp = numericWaterTemp !== null && !Number.isNaN(numericWaterTemp) && numericWaterTemp >= 67;

  const toggleHatchChip = (hatchName: string) => {
    const current = hatches
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (current.includes(hatchName)) {
      setHatches(current.filter((h) => h !== hatchName).join(', '));
    } else {
      setHatches([...current, hatchName].join(', '));
    }
  };

  const handleAutoFillConditions = async () => {
    if (!locationId) {
      setConditionsStatus('Select a fishing location first.');
      return;
    }
    setFetchingConditions(true);
    setConditionsStatus('');
    try {
      const result = await api.lookupConditions({
        locationId: Number(locationId),
        date: tripDate,
      });

      const parts: string[] = [];
      if (result.usgs) {
        if (result.usgs.flowCfs !== null) {
          setRiverFlowCfs(String(result.usgs.flowCfs));
          parts.push(`${result.usgs.flowCfs} CFS`);
        }
        if (result.usgs.gaugeHeightFt !== null) {
          setGaugeHeightFt(String(result.usgs.gaugeHeightFt));
          parts.push(`${result.usgs.gaugeHeightFt} ft gauge`);
        }
        if (result.usgs.waterTempF !== null) {
          setWaterTempF(String(result.usgs.waterTempF));
          parts.push(`${result.usgs.waterTempF}°F water`);
        }
      }
      if (result.weather) {
        if (result.weather.summary) {
          setWeatherSummary(result.weather.summary);
          parts.push(result.weather.summary);
        }
        if (result.weather.airTempF !== null) {
          setAirTempF(String(result.weather.airTempF));
          parts.push(`${result.weather.airTempF}°F air`);
        }
        if (result.weather.windMph !== null) {
          setWindMph(String(result.weather.windMph));
        }
        if (result.weather.barometricPressureInHg !== null) {
          setBarometricPressure(String(result.weather.barometricPressureInHg));
        }
      }

      if (parts.length > 0) {
        setConditionsStatus(`Loaded conditions: ${parts.join(' • ')}`);
      } else {
        setConditionsStatus(
          selectedLocation?.usgs_site_no
            ? 'No historical readings returned for this date/site.'
            : 'Location has no USGS gauge linked; weather data unavailable.'
        );
      }
    } catch {
      setConditionsStatus('Could not fetch live/historical conditions right now.');
    } finally {
      setFetchingConditions(false);
    }
  };

  const addCatchRow = () => {
    setCatches((prev) => [
      ...prev,
      {
        species: 'Wild Rainbow Trout',
        count: 1,
        length_inches: null,
        weight_lbs: null,
        fly_or_lure: '',
        notes: '',
      },
    ]);
  };

  const updateCatchRow = (index: number, patch: Partial<CatchEntry>) => {
    setCatches((prev) => prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  };

  const removeCatchRow = (index: number) => {
    setCatches((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleDeleteExistingImage = async (imageId: number) => {
    if (!initialTrip) return;
    try {
      await api.deleteTripImage(initialTrip.id, imageId);
      setExistingImages((prev) => prev.filter((img) => img.id !== imageId));
    } catch {
      setError('Failed to remove image.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!description.trim()) {
      setError('Trip description is required.');
      return;
    }
    if (!locationId) {
      setError('Please select a location.');
      return;
    }

    setSaving(true);
    try {
      const payload: Partial<Trip> = {
        description: description.trim(),
        trip_date: tripDate,
        location_id: Number(locationId),
        score,
        comments: comments.trim(),
        rig_type: rigType.trim(),
        hatches: hatches.trim(),
        water_clarity: waterClarity.trim(),
        river_flow_cfs: riverFlowCfs !== '' ? Number(riverFlowCfs) : null,
        gauge_height_ft: gaugeHeightFt !== '' ? Number(gaugeHeightFt) : null,
        water_temp_f: waterTempF !== '' ? Number(waterTempF) : null,
        weather_summary: weatherSummary.trim(),
        air_temp_f: airTempF !== '' ? Number(airTempF) : null,
        wind_mph: windMph !== '' ? Number(windMph) : null,
        barometric_pressure: barometricPressure !== '' ? Number(barometricPressure) : null,
        catches: catches.filter((c) => c.species.trim() !== ''),
      };

      let savedTrip = initialTrip
        ? await api.updateTrip(initialTrip.id, payload)
        : await api.createTrip(payload);

      if (pendingFiles.length > 0) {
        const uploaded = await api.uploadTripImages(savedTrip.id, pendingFiles);
        savedTrip = {
          ...savedTrip,
          images: [...(savedTrip.images ?? []), ...uploaded],
        };
      }

      onSaved(savedTrip);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save trip');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-sky-100 text-sky-700">
              <Fish className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {initialTrip ? 'Edit Fly-Fishing Session' : 'Log Truckee Fly-Fishing Session'}
              </h2>
              <p className="text-xs text-slate-500">
                Record your beat, USGS flow &amp; water temp, hatches, rig setup, and trout landed
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
              {error}
            </div>
          )}

          {/* Core Trip Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                Session Title / Description *
              </label>
              <input
                type="text"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Morning Euro-Nymphing Pocket Water below Boca Bridge"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                Date &amp; Time *
              </label>
              <input
                type="datetime-local"
                required
                value={tripDate}
                onChange={(e) => setTripDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                  River Beat / Location *
                </label>
                <button
                  type="button"
                  onClick={onRequestNewLocation}
                  className="text-xs font-semibold text-sky-600 hover:text-sky-800 inline-flex items-center gap-0.5 cursor-pointer"
                >
                  <MapPin className="w-3 h-3" /> + New Beat
                </button>
              </div>
              <select
                value={locationId}
                onChange={(e) => setLocationId(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
              >
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} {loc.water_body ? `(${loc.water_body})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Fly Fishing Setup: Rig / Technique, Water Clarity & Hatches */}
          <div className="rounded-xl border border-sky-200/80 bg-sky-50/40 p-4 space-y-3.5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-900">
              <Bug className="w-4 h-4 text-sky-600" />
              Fly-Fishing Rig, Water Clarity &amp; Entomology
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Primary Rig / Technique
                </label>
                <input
                  type="text"
                  list="truckee-rigs"
                  value={rigType}
                  onChange={(e) => setRigType(e.target.value)}
                  placeholder="e.g., Euro / Tight-Line Nymphing"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-sky-500"
                />
                <datalist id="truckee-rigs">
                  {TRUCKEE_RIG_TYPES.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Water Clarity
                </label>
                <select
                  value={waterClarity}
                  onChange={(e) => setWaterClarity(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-sky-500"
                >
                  {WATER_CLARITY_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Active Hatches / Forage Observed
              </label>
              <input
                type="text"
                value={hatches}
                onChange={(e) => setHatches(e.target.value)}
                placeholder="Click chips below or type hatches (e.g., BWO, PMD, Golden Stones)..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-sky-500 mb-2"
              />
              <div className="flex flex-wrap gap-1.5">
                {TRUCKEE_HATCHES.map((h) => {
                  const isActive = hatches
                    .split(',')
                    .map((s) => s.trim())
                    .includes(h);
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() => toggleHatchChip(h)}
                      className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full border transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-sky-600 text-white border-sky-700'
                          : 'bg-white text-slate-600 hover:bg-sky-50 border-slate-200'
                      }`}
                    >
                      {isActive ? `✓ ${h}` : `+ ${h}`}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Star Rating */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-3.5 rounded-xl bg-amber-50/60 border border-amber-200/80">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-amber-900">
                Session Rating
              </div>
              <div className="text-xs text-amber-700">
                How was the fishing action, flow wadeability, and hatch activity?
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StarRating score={score} onChange={setScore} size="lg" />
              <span className="text-sm font-bold text-amber-900 w-12">{score} / 5</span>
            </div>
          </div>

          {/* USGS River & Weather Conditions Section */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Waves className="w-4 h-4 text-teal-600" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  USGS Truckee River Flow &amp; Weather
                </span>
                {selectedLocation?.usgs_site_no && (
                  <span className="text-[11px] font-mono bg-teal-100 text-teal-800 px-2 py-0.5 rounded-md">
                    Gauge #{selectedLocation.usgs_site_no}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleAutoFillConditions}
                disabled={fetchingConditions}
                className="inline-flex items-center gap-1.5 text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                {fetchingConditions ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                Auto-Fill from USGS &amp; Weather
              </button>
            </div>

            {conditionsStatus && (
              <p className="text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 px-3 py-1.5 rounded-lg">
                {conditionsStatus}
              </p>
            )}

            {isHootOwlTemp && (
              <div className="flex items-center gap-2 text-xs font-semibold bg-amber-100 text-amber-950 border border-amber-300 px-3 py-2 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                <span>
                  Hoot Owl Thermal Stress Alert ({numericWaterTemp}°F ≥ 67°F): Consider fishing early
                  morning hours only or moving to colder tailwater below Boca.
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  River Flow (CFS)
                </label>
                <input
                  type="number"
                  step="any"
                  value={riverFlowCfs}
                  onChange={(e) => setRiverFlowCfs(e.target.value)}
                  placeholder="e.g., 425"
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Gauge Height (ft)
                </label>
                <input
                  type="number"
                  step="any"
                  value={gaugeHeightFt}
                  onChange={(e) => setGaugeHeightFt(e.target.value)}
                  placeholder="e.g., 3.85"
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Water Temp (°F)
                </label>
                <input
                  type="number"
                  step="any"
                  value={waterTempF}
                  onChange={(e) => setWaterTempF(e.target.value)}
                  placeholder="e.g., 55"
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Sky / Weather
                </label>
                <input
                  type="text"
                  value={weatherSummary}
                  onChange={(e) => setWeatherSummary(e.target.value)}
                  placeholder="e.g., Overcast"
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Air Temp (°F)
                </label>
                <input
                  type="number"
                  step="any"
                  value={airTempF}
                  onChange={(e) => setAirTempF(e.target.value)}
                  placeholder="e.g., 64"
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Wind (mph)
                </label>
                <input
                  type="number"
                  step="any"
                  value={windMph}
                  onChange={(e) => setWindMph(e.target.value)}
                  placeholder="e.g., 7"
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-teal-500"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Barometric Pressure (inHg)
                </label>
                <input
                  type="number"
                  step="any"
                  value={barometricPressure}
                  onChange={(e) => setBarometricPressure(e.target.value)}
                  placeholder="e.g., 29.92"
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-teal-500"
                />
              </div>
            </div>
          </div>

          {/* Catches Logged */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Fish className="w-4 h-4 text-sky-600" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Trout &amp; Fish Landed ({catches.reduce((sum, c) => sum + (Number(c.count) || 0), 0)}{' '}
                  total)
                </span>
              </div>
              <button
                type="button"
                onClick={addCatchRow}
                className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add Fish / Pattern
              </button>
            </div>

            <datalist id="truckee-species">
              <option value="Wild Rainbow Trout" />
              <option value="Brown Trout" />
              <option value="Mountain Whitefish" />
              <option value="Brook Trout" />
              <option value="Lahontan Cutthroat Trout" />
            </datalist>

            <datalist id="truckee-flies">
              <option value="#8 Pat's Rubber Legs (Brown/Olive)" />
              <option value="#16 Olive Perdigon" />
              <option value="#18 Juju Baetis" />
              <option value="#16 PMD Sparkle Dun" />
              <option value="#14 Elk Hair Caddis" />
              <option value="#12 Green Drake Comparadun" />
              <option value="#6 Olive Sculpzilla" />
              <option value="#8 Near Nuff Crayfish" />
              <option value="#10 Golden Stone Nymph" />
              <option value="#18 Pheasant Tail (Tungsten)" />
              <option value="#20 Black Zebra Midge" />
              <option value="#10 Chubby Chernobyl" />
            </datalist>

            {catches.length === 0 ? (
              <div className="text-center py-4 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500">
                No individual fish logged yet. Click <strong>+ Add Fish / Pattern</strong> to record
                species, inches, and the winning fly pattern.
              </div>
            ) : (
              <div className="space-y-2.5">
                {catches.map((item, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-center p-2.5 rounded-xl bg-slate-50 border border-slate-200"
                  >
                    <div className="col-span-5 sm:col-span-3">
                      <input
                        type="text"
                        list="truckee-species"
                        value={item.species}
                        onChange={(e) => updateCatchRow(idx, { species: e.target.value })}
                        placeholder="Species (e.g. Brown Trout)"
                        className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-sky-500"
                      />
                    </div>
                    <div className="col-span-3 sm:col-span-2">
                      <input
                        type="number"
                        min={1}
                        value={item.count}
                        onChange={(e) =>
                          updateCatchRow(idx, { count: Math.max(1, Number(e.target.value) || 1) })
                        }
                        placeholder="Qty"
                        title="Count"
                        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-sky-500"
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <input
                        type="number"
                        step="any"
                        value={item.length_inches ?? ''}
                        onChange={(e) =>
                          updateCatchRow(idx, {
                            length_inches: e.target.value !== '' ? Number(e.target.value) : null,
                          })
                        }
                        placeholder="Max Length (in)"
                        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-sky-500"
                      />
                    </div>
                    <div className="col-span-10 sm:col-span-4">
                      <input
                        type="text"
                        list="truckee-flies"
                        value={item.fly_or_lure}
                        onChange={(e) => updateCatchRow(idx, { fly_or_lure: e.target.value })}
                        placeholder="Fly Pattern & Hook Size (e.g. #16 Olive Perdigon)"
                        className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-sky-500"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => removeCatchRow(idx)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors cursor-pointer"
                        title="Remove catch"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Journal Comments */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
              River Notes, Holding Water &amp; Tippet / Leader Notes
            </label>
            <textarea
              rows={3}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="e.g., 4X fluorocarbon to point fly, 5X to dropper. Fish were holding in waist-deep walking-speed boulder seams..."
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
            />
          </div>

          {/* Trip Photos (TripImage) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-slate-500" />
                Session Photos
              </span>
              <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg cursor-pointer transition-colors">
                <Plus className="w-3.5 h-3.5" />
                Select Photos
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) {
                      setPendingFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
                    }
                  }}
                />
              </label>
            </div>

            {(existingImages.length > 0 || pendingFiles.length > 0) && (
              <div className="flex flex-wrap gap-3 pt-1">
                {existingImages.map((img) => (
                  <div
                    key={img.id}
                    className="relative group w-20 h-20 rounded-lg overflow-hidden border border-slate-200 bg-slate-100"
                  >
                    <img src={getAuthenticatedMediaUrl(img.url)} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => handleDeleteExistingImage(img.id)}
                      className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      title="Delete photo"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}

                {pendingFiles.map((file, idx) => (
                  <div
                    key={idx}
                    className="relative group w-20 h-20 rounded-lg overflow-hidden border border-sky-300 bg-sky-50 flex items-center justify-center p-1 text-center"
                  >
                    <span className="text-[10px] font-medium text-sky-900 line-clamp-3 break-all">
                      {file.name}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingFiles((prev) => prev.filter((_, fileIdx) => fileIdx !== idx))
                      }
                      className="absolute top-1 right-1 bg-slate-800 text-white rounded-full p-0.5 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold bg-sky-600 hover:bg-sky-700 text-white shadow-sm transition-colors cursor-pointer disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {initialTrip ? 'Save Changes' : 'Save Fishing Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
