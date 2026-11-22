import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  CloudSun,
  Compass,
  Loader2,
  MapPin,
  Sparkles,
  Trash2,
  Upload,
  Waves,
  X,
} from 'lucide-react';
import type { ConditionsLookupResult, Location } from '../../shared/types.ts';
import {
  formatDuration,
  groupPhotosIntoSessions,
  type DerivedPhotoSession,
} from '../../shared/photoSessions.ts';
import { api } from '../api.ts';
import { extractPhotosMeta, type ExtractedPhoto } from '../utils/exif.ts';
import { StarRating } from './StarRating.tsx';

interface PhotoImportModalProps {
  locations: Location[];
  onClose: () => void;
  onImported: () => Promise<void> | void;
}

interface EditableSessionDraft extends DerivedPhotoSession {
  included: boolean;
  score: number;
  comments: string;
  locationMode: 'existing' | 'new';
  selectedLocationId: number;
  newBeatName: string;
  conditions: ConditionsLookupResult | null;
  loadingConditions: boolean;
}

const CREATE_NEW_BEAT_VALUE = -1;

export const PhotoImportModal: React.FC<PhotoImportModalProps> = ({
  locations,
  onClose,
  onImported,
}) => {
  const [photos, setPhotos] = useState<ExtractedPhoto[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [maxGapHours, setMaxGapHours] = useState<number>(6);
  const [drafts, setDrafts] = useState<EditableSessionDraft[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const photosRef = useRef<ExtractedPhoto[]>([]);
  photosRef.current = photos;

  useEffect(() => {
    return () => {
      for (const p of photosRef.current) {
        URL.revokeObjectURL(p.previewUrl);
      }
    };
  }, []);

  const photoById = useMemo(() => {
    const map = new Map<string, ExtractedPhoto>();
    for (const p of photos) {
      map.set(p.meta.id, p);
    }
    return map;
  }, [photos]);

  const fetchConditionsForDraft = async (
    draftId: string,
    params: { locationId?: number; lat?: number; lng?: number; date: string }
  ) => {
    setDrafts((prev) =>
      prev.map((d) => (d.id === draftId ? { ...d, loadingConditions: true } : d))
    );
    try {
      const result = await api.lookupConditions(params);
      setDrafts((prev) =>
        prev.map((d) =>
          d.id === draftId ? { ...d, conditions: result, loadingConditions: false } : d
        )
      );
    } catch {
      setDrafts((prev) =>
        prev.map((d) => (d.id === draftId ? { ...d, loadingConditions: false } : d))
      );
    }
  };

  const rebuildDrafts = (nextPhotos: ExtractedPhoto[], gapHours: number) => {
    const grouped = groupPhotosIntoSessions(
      nextPhotos.map((p) => p.meta),
      locations,
      { maxGapHours: gapHours, maxDistanceMiles: 5, maxLocationMatchMiles: 10 }
    );

    const nextDrafts: EditableSessionDraft[] = grouped.map((g) => {
      const hasMatchedBeat = g.matchedLocationId !== null;
      const hasGps = g.centroidLat !== null && g.centroidLng !== null;
      const defaultLocId = g.matchedLocationId ?? locations[0]?.id ?? 0;
      const useNewBeat = !hasMatchedBeat && hasGps;

      return {
        ...g,
        included: true,
        score: 4,
        comments: '',
        locationMode: useNewBeat ? 'new' : 'existing',
        selectedLocationId: defaultLocId,
        newBeatName:
          hasGps && g.centroidLat !== null && g.centroidLng !== null
            ? `River Beat (${g.centroidLat.toFixed(3)}, ${g.centroidLng.toFixed(3)})`
            : 'New River Beat',
        conditions: null,
        loadingConditions: false,
      };
    });

    setDrafts(nextDrafts);

    for (const d of nextDrafts) {
      if (d.locationMode === 'existing' && d.selectedLocationId) {
        void fetchConditionsForDraft(d.id, {
          locationId: d.selectedLocationId,
          date: d.tripDate,
        });
      } else if (d.centroidLat !== null && d.centroidLng !== null) {
        void fetchConditionsForDraft(d.id, {
          lat: d.centroidLat,
          lng: d.centroidLng,
          date: d.tripDate,
        });
      }
    }
  };

  const handleFilesSelected = async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).filter((f) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|gif)$/i.test(f.name));
    if (incoming.length === 0) return;

    setError('');
    setExtracting(true);
    try {
      const extracted = await extractPhotosMeta(incoming);
      const merged = [...photos, ...extracted];
      setPhotos(merged);
      rebuildDrafts(merged, maxGapHours);
    } catch {
      setError('Could not read metadata from one or more photos.');
    } finally {
      setExtracting(false);
    }
  };

  const handleGapChange = (hours: number) => {
    setMaxGapHours(hours);
    if (photos.length > 0) {
      rebuildDrafts(photos, hours);
    }
  };

  const handleRemovePhotoFromDraft = (draftId: string, photoId: string) => {
    const target = photoById.get(photoId);
    if (target) {
      URL.revokeObjectURL(target.previewUrl);
    }
    const remainingPhotos = photos.filter((p) => p.meta.id !== photoId);
    setPhotos(remainingPhotos);
    setDrafts((prev) =>
      prev
        .map((d) =>
          d.id === draftId
            ? { ...d, photoIds: d.photoIds.filter((id) => id !== photoId) }
            : d
        )
        .filter((d) => d.photoIds.length > 0)
    );
  };

  const updateDraft = (draftId: string, patch: Partial<EditableSessionDraft>) => {
    setDrafts((prev) => prev.map((d) => (d.id === draftId ? { ...d, ...patch } : d)));
  };

  const includedDrafts = drafts.filter((d) => d.included && d.photoIds.length > 0);

  const handleImport = async () => {
    if (includedDrafts.length === 0) {
      setError('Select at least one derived session to import.');
      return;
    }

    for (const d of includedDrafts) {
      if (!d.title.trim()) {
        setError('Every included session needs a title.');
        return;
      }
      if (d.locationMode === 'existing' && !d.selectedLocationId) {
        setError(`Select a River Beat for "${d.title}".`);
        return;
      }
      if (d.locationMode === 'new' && !d.newBeatName.trim()) {
        setError(`Enter a River Beat name for "${d.title}".`);
        return;
      }
    }

    setImporting(true);
    setError('');

    try {
      for (let i = 0; i < includedDrafts.length; i++) {
        const d = includedDrafts[i];
        setImportProgress(`Importing session ${i + 1} of ${includedDrafts.length}...`);

        let locationId = d.selectedLocationId;
        if (d.locationMode === 'new' && d.centroidLat !== null && d.centroidLng !== null) {
          let nearestSiteNo = '';
          try {
            const nearby = await api.findNearbyGauges(d.centroidLat, d.centroidLng);
            if (nearby.length > 0) {
              nearestSiteNo = nearby[0].siteNo;
            }
          } catch {
            // optional gauge lookup
          }

          const createdLoc = await api.createLocation({
            name: d.newBeatName.trim(),
            latitude: Number(d.centroidLat.toFixed(6)),
            longitude: Number(d.centroidLng.toFixed(6)),
            water_body: '',
            usgs_site_no: nearestSiteNo,
            notes: 'Created from photo GPS EXIF during retroactive session import.',
          });
          locationId = createdLoc.id;
        }

        const createdTrip = await api.createTrip({
          description: d.title.trim(),
          trip_date: d.tripDate,
          duration_minutes: d.durationMinutes,
          location_id: locationId,
          score: d.score,
          comments: d.comments.trim(),
          river_flow_cfs: d.conditions?.usgs?.flowCfs ?? null,
          gauge_height_ft: d.conditions?.usgs?.gaugeHeightFt ?? null,
          water_temp_f: d.conditions?.usgs?.waterTempF ?? null,
          weather_summary: d.conditions?.weather?.summary ?? '',
          air_temp_f: d.conditions?.weather?.airTempF ?? null,
          wind_mph: d.conditions?.weather?.windMph ?? null,
          barometric_pressure: d.conditions?.weather?.barometricPressureInHg ?? null,
          catches: [],
        });

        const filesToUpload = d.photoIds
          .map((id) => photoById.get(id)?.file)
          .filter((f): f is File => Boolean(f));

        if (filesToUpload.length > 0) {
          await api.uploadTripImages(createdTrip.id, filesToUpload);
        }
      }

      await onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import photo sessions.');
    } finally {
      setImporting(false);
      setImportProgress('');
    }
  };

  const gpsCount = photos.filter((p) => p.meta.lat !== null && p.meta.lng !== null).length;
  const exifDateCount = photos.filter((p) => p.meta.dateSource === 'exif').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-teal-100 text-teal-700">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Retroactive Import from Past Photos
              </h2>
              <p className="text-xs text-slate-500">
                Reads photo EXIF date/time &amp; GPS lat/long to group photos into fishing sessions
                and fetch historical USGS flows
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

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
              {error}
            </div>
          )}

          {/* Dropzone */}
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files) {
                void handleFilesSelected(e.dataTransfer.files);
              }
            }}
            className={`flex flex-col items-center justify-center gap-2 p-6 rounded-2xl border-2 border-dashed transition-colors cursor-pointer ${
              dragOver
                ? 'border-teal-500 bg-teal-50/70'
                : 'border-slate-300 bg-slate-50/70 hover:border-teal-400 hover:bg-teal-50/30'
            }`}
          >
            {extracting ? (
              <Loader2 className="w-7 h-7 animate-spin text-teal-600" />
            ) : (
              <Upload className="w-7 h-7 text-teal-600" />
            )}
            <div className="text-sm font-semibold text-slate-800">
              {extracting
                ? 'Reading EXIF timestamps & GPS coordinates...'
                : 'Drop past fishing photos here or click to select'}
            </div>
            <div className="text-xs text-slate-500">
              Supports JPEG, HEIC/HEIF, PNG, WebP • Groups photos by time &amp; location automatically
            </div>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) {
                  void handleFilesSelected(e.target.files);
                  e.target.value = '';
                }
              }}
            />
          </label>

          {/* Summary & Grouping Controls */}
          {photos.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-100/80 border border-slate-200 rounded-xl px-4 py-3 text-xs">
              <div className="flex flex-wrap items-center gap-3 text-slate-700 font-medium">
                <span>
                  <strong>{photos.length}</strong> photo(s) loaded
                </span>
                <span className="text-slate-300">•</span>
                <span>
                  <strong>{exifDateCount}</strong> with EXIF date
                </span>
                <span className="text-slate-300">•</span>
                <span>
                  <strong>{gpsCount}</strong> with GPS coordinates
                </span>
                <span className="text-slate-300">•</span>
                <span className="text-teal-800 font-bold">
                  {drafts.length} session(s) derived
                </span>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-slate-600 font-semibold">Group gap:</label>
                <select
                  value={maxGapHours}
                  onChange={(e) => handleGapChange(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 outline-none focus:border-teal-500"
                >
                  <option value={4}>4 hours</option>
                  <option value={6}>6 hours</option>
                  <option value={12}>12 hours</option>
                  <option value={24}>24 hours</option>
                </select>
              </div>
            </div>
          )}

          {/* Derived Sessions List */}
          {drafts.length > 0 && (
            <div className="space-y-4">
              {drafts.map((draft) => (
                <div
                  key={draft.id}
                  className={`rounded-2xl border p-4 space-y-4 transition-colors ${
                    draft.included
                      ? 'bg-white border-slate-200 shadow-xs'
                      : 'bg-slate-50 border-slate-200/70 opacity-60'
                  }`}
                >
                  {/* Top row: Checkbox + Title + Rating */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 flex-1 min-w-[240px]">
                      <input
                        type="checkbox"
                        checked={draft.included}
                        onChange={(e) => updateDraft(draft.id, { included: e.target.checked })}
                        className="w-4 h-4 accent-teal-600 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={draft.title}
                        onChange={(e) => updateDraft(draft.id, { title: e.target.value })}
                        className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-900 focus:border-teal-500 outline-none"
                      />
                    </div>
                    <StarRating
                      score={draft.score}
                      onChange={(score) => updateDraft(draft.id, { score })}
                      size="md"
                    />
                  </div>

                  {/* Date, Duration & Beat/GPS */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        Session Start (from EXIF)
                      </label>
                      <div className="relative">
                        <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="datetime-local"
                          value={draft.tripDate}
                          onChange={(e) => updateDraft(draft.id, { tripDate: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 pl-8 pr-2.5 py-1.5 text-xs focus:border-teal-500 outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        River Beat
                      </label>
                      <select
                        value={
                          draft.locationMode === 'new'
                            ? CREATE_NEW_BEAT_VALUE
                            : draft.selectedLocationId
                        }
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          if (val === CREATE_NEW_BEAT_VALUE) {
                            updateDraft(draft.id, { locationMode: 'new' });
                          } else {
                            updateDraft(draft.id, {
                              locationMode: 'existing',
                              selectedLocationId: val,
                            });
                            void fetchConditionsForDraft(draft.id, {
                              locationId: val,
                              date: draft.tripDate,
                            });
                          }
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-500 outline-none"
                      >
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}
                            {draft.matchedLocationId === loc.id &&
                            draft.matchedDistanceMiles !== null
                              ? ` (${draft.matchedDistanceMiles} mi)`
                              : ''}
                          </option>
                        ))}
                        {draft.centroidLat !== null && draft.centroidLng !== null && (
                          <option value={CREATE_NEW_BEAT_VALUE}>
                            + Create New Beat at Photo GPS ({draft.centroidLat.toFixed(3)},{' '}
                            {draft.centroidLng.toFixed(3)})
                          </option>
                        )}
                      </select>
                    </div>

                    {draft.locationMode === 'new' ? (
                      <div>
                        <label className="block text-[11px] font-semibold text-teal-700 mb-1">
                          New Beat Name
                        </label>
                        <input
                          type="text"
                          value={draft.newBeatName}
                          onChange={(e) => updateDraft(draft.id, { newBeatName: e.target.value })}
                          placeholder="e.g., Verdi Bridge Run"
                          className="w-full rounded-lg border border-teal-300 bg-teal-50/40 px-2.5 py-1.5 text-xs focus:border-teal-500 outline-none"
                        />
                      </div>
                    ) : (
                      <div className="flex items-end pb-1 gap-2 text-xs text-slate-500">
                        {draft.durationMinutes && (
                          <span className="inline-flex items-center gap-1 bg-slate-100 px-2.5 py-1 rounded-md font-medium text-slate-700">
                            <Clock className="w-3.5 h-3.5 text-slate-500" />
                            {formatDuration(draft.durationMinutes)}
                          </span>
                        )}
                        {draft.centroidLat !== null && draft.centroidLng !== null && (
                          <span className="inline-flex items-center gap-1 bg-sky-50 text-sky-800 px-2.5 py-1 rounded-md font-mono text-[11px]">
                            <Compass className="w-3.5 h-3.5 text-sky-600" />
                            {draft.centroidLat.toFixed(4)}, {draft.centroidLng.toFixed(4)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Historical Conditions Preview */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 border border-slate-200/80 px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      {draft.loadingConditions ? (
                        <span className="inline-flex items-center gap-1.5 text-teal-700 font-medium">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Fetching historical USGS &amp; weather...
                        </span>
                      ) : draft.conditions ? (
                        <>
                          {draft.conditions.usgs?.flowCfs !== null &&
                            draft.conditions.usgs?.flowCfs !== undefined && (
                              <span className="inline-flex items-center gap-1 bg-teal-50 text-teal-800 border border-teal-200 px-2 py-0.5 rounded-md font-semibold">
                                <Waves className="w-3 h-3" />
                                {draft.conditions.usgs.flowCfs.toLocaleString()} CFS
                              </span>
                            )}
                          {draft.conditions.usgs?.waterTempF !== null &&
                            draft.conditions.usgs?.waterTempF !== undefined && (
                              <span className="bg-cyan-50 text-cyan-800 border border-cyan-200 px-2 py-0.5 rounded-md font-semibold">
                                Water {draft.conditions.usgs.waterTempF}°F
                              </span>
                            )}
                          {draft.conditions.weather?.summary && (
                            <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded-md font-medium">
                              <CloudSun className="w-3 h-3" />
                              {draft.conditions.weather.summary}
                              {draft.conditions.weather.airTempF !== null
                                ? ` (${draft.conditions.weather.airTempF}°F)`
                                : ''}
                            </span>
                          )}
                          {!draft.conditions.usgs?.flowCfs && !draft.conditions.weather?.summary && (
                            <span className="text-slate-400">
                              No historical conditions found for this date/location
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400">Conditions not loaded</span>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={draft.loadingConditions}
                      onClick={() => {
                        if (draft.locationMode === 'existing' && draft.selectedLocationId) {
                          void fetchConditionsForDraft(draft.id, {
                            locationId: draft.selectedLocationId,
                            date: draft.tripDate,
                          });
                        } else if (draft.centroidLat !== null && draft.centroidLng !== null) {
                          void fetchConditionsForDraft(draft.id, {
                            lat: draft.centroidLat,
                            lng: draft.centroidLng,
                            date: draft.tripDate,
                          });
                        }
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:text-teal-900 cursor-pointer disabled:opacity-50"
                    >
                      <Sparkles className="w-3 h-3" /> Refresh Conditions
                    </button>
                  </div>

                  {/* Photo Thumbnails in Group */}
                  <div className="flex flex-wrap gap-2.5">
                    {draft.photoIds.map((pid) => {
                      const photo = photoById.get(pid);
                      if (!photo) return null;
                      return (
                        <div
                          key={pid}
                          className="relative group w-24 rounded-xl overflow-hidden border border-slate-200 bg-slate-100"
                        >
                          <img
                            src={photo.previewUrl}
                            alt={photo.meta.fileName}
                            className="w-24 h-20 object-cover"
                          />
                          <div className="px-1.5 py-1 bg-white/95 text-[10px] text-slate-600 truncate flex items-center justify-between gap-1">
                            <span className="truncate">
                              {photo.meta.takenAt
                                ? photo.meta.takenAt.slice(11, 16)
                                : 'No time'}
                            </span>
                            {photo.meta.lat !== null && (
                              <MapPin className="w-2.5 h-2.5 text-teal-600 shrink-0" />
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemovePhotoFromDraft(draft.id, pid)}
                            title="Remove photo"
                            className="absolute top-1 right-1 bg-slate-900/75 hover:bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <div className="text-xs text-slate-500">
            {importProgress || `${includedDrafts.length} session(s) ready to import`}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={importing}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={importing || includedDrafts.length === 0}
              onClick={handleImport}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-colors cursor-pointer disabled:opacity-50"
            >
              {importing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              Import {includedDrafts.length} Session{includedDrafts.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
