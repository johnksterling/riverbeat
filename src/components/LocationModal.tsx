import React, { useState } from 'react';
import { Compass, Loader2, MapPin, Radio, X } from 'lucide-react';
import type { Location, USGSGaugeInfo } from '../../shared/types.ts';
import { api } from '../api.ts';
import { LeafletMap } from './LeafletMap.tsx';

const TRUCKEE_GAUGE_PRESETS = [
  { siteNo: '10337500', label: 'Tahoe City (#10337500)', river: 'Truckee River' },
  { siteNo: '10338000', label: 'Near Truckee / Hwy 89 (#10338000)', river: 'Truckee River' },
  { siteNo: '10344400', label: 'Little Truckee abv Boca (#10344400)', river: 'Little Truckee River' },
  { siteNo: '10344505', label: 'Boca Bridge / Hirschdale (#10344505)', river: 'Truckee River' },
  { siteNo: '10346000', label: 'Farad Canyon (#10346000)', river: 'Truckee River' },
  { siteNo: '10348000', label: 'Reno, NV (#10348000)', river: 'Truckee River' },
];

interface LocationModalProps {
  initialLocation?: Location | null;
  onClose: () => void;
  onSaved: (location: Location) => void;
}

export const LocationModal: React.FC<LocationModalProps> = ({
  initialLocation,
  onClose,
  onSaved,
}) => {
  const [name, setName] = useState(initialLocation?.name ?? '');
  const [waterBody, setWaterBody] = useState(initialLocation?.water_body ?? 'Truckee River');
  const [latitude, setLatitude] = useState<string>(
    initialLocation ? String(initialLocation.latitude) : '39.3452'
  );
  const [longitude, setLongitude] = useState<string>(
    initialLocation ? String(initialLocation.longitude) : '-120.1180'
  );
  const [usgsSiteNo, setUsgsSiteNo] = useState(initialLocation?.usgs_site_no ?? '10338000');
  const [notes, setNotes] = useState(initialLocation?.notes ?? '');

  const [nearbyGauges, setNearbyGauges] = useState<USGSGaugeInfo[]>([]);
  const [searchingGauges, setSearchingGauges] = useState(false);
  const [gaugeSearchMessage, setGaugeSearchMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const parsedLat = Number(latitude);
  const parsedLng = Number(longitude);
  const validCoords = !Number.isNaN(parsedLat) && !Number.isNaN(parsedLng);

  const handleFindNearbyGauges = async () => {
    if (!validCoords) {
      setError('Enter valid latitude and longitude first.');
      return;
    }
    setSearchingGauges(true);
    setGaugeSearchMessage('');
    try {
      const gauges = await api.findNearbyGauges(parsedLat, parsedLng);
      setNearbyGauges(gauges);
      if (gauges.length === 0) {
        setGaugeSearchMessage('No active USGS stream gauges found within ~25 miles of this pin.');
      } else {
        setGaugeSearchMessage(
          `Found ${gauges.length} active USGS gauge(s) nearby. Click one below or on the map to link it.`
        );
      }
    } catch {
      setGaugeSearchMessage('Could not reach USGS Water Services right now.');
    } finally {
      setSearchingGauges(false);
    }
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(String(Math.round(pos.coords.latitude * 100000) / 100000));
        setLongitude(String(Math.round(pos.coords.longitude * 100000) / 100000));
      },
      () => {
        setError('Unable to access browser location.');
      }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Location name is required.');
      return;
    }
    if (!validCoords) {
      setError('Valid latitude and longitude coordinates are required.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        water_body: waterBody.trim(),
        latitude: parsedLat,
        longitude: parsedLng,
        usgs_site_no: usgsSiteNo.trim(),
        notes: notes.trim(),
      };
      const saved = initialLocation
        ? await api.updateLocation(initialLocation.id, payload)
        : await api.createLocation(payload);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save location');
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
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {initialLocation ? 'Edit River Access / Beat' : 'New Truckee / Sierra Fishing Spot'}
              </h2>
              <p className="text-xs text-slate-500">
                Click the USGS Topo map or drag the orange pin to mark access &amp; link a USGS gauge
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

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                Access Spot / Beat Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Hirschdale Bridge Pocket Water"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                Water Body / Stretch
              </label>
              <input
                type="text"
                list="truckee-waters"
                value={waterBody}
                onChange={(e) => setWaterBody(e.target.value)}
                placeholder="e.g., Truckee River"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
              />
              <datalist id="truckee-waters">
                <option value="Truckee River" />
                <option value="Little Truckee River" />
                <option value="East Fork Carson River" />
                <option value="North Fork Yuba River" />
                <option value="Pyramid Lake" />
                <option value="Prosser Creek Reservoir" />
                <option value="Boca Reservoir" />
              </datalist>
            </div>
          </div>

          {/* Interactive Map Picker */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                Pin Access Point on USGS Topo Map (Click or Drag Pin)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleUseMyLocation}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                >
                  <Compass className="w-3.5 h-3.5 text-sky-600" />
                  Use My Location
                </button>
                <button
                  type="button"
                  onClick={handleFindNearbyGauges}
                  disabled={searchingGauges}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  {searchingGauges ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Radio className="w-3.5 h-3.5 text-teal-600" />
                  )}
                  Find Nearby USGS Gauges
                </button>
              </div>
            </div>

            <LeafletMap
              pickerPosition={validCoords ? { lat: parsedLat, lng: parsedLng } : null}
              onPickPosition={(lat, lng) => {
                setLatitude(String(lat));
                setLongitude(String(lng));
              }}
              nearbyGauges={nearbyGauges}
              onSelectGauge={(g) => {
                setUsgsSiteNo(g.siteNo);
                if (!waterBody && g.siteName) {
                  setWaterBody(g.siteName);
                }
              }}
              center={validCoords ? [parsedLat, parsedLng] : [39.355, -120.11]}
              zoom={initialLocation ? 12 : 10}
              heightClass="h-[260px]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                Latitude *
              </label>
              <input
                type="number"
                step="any"
                required
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                Longitude *
              </label>
              <input
                type="number"
                step="any"
                required
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                USGS Gauge Site #
              </label>
              <input
                type="text"
                value={usgsSiteNo}
                onChange={(e) => setUsgsSiteNo(e.target.value)}
                placeholder="e.g., 10344505"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-teal-500 focus:ring-2 focus:ring-teal-200 outline-none"
              />
            </div>
          </div>

          {/* Quick-Pick Truckee River Gauges */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Quick-Select Truckee Watershed USGS Gauge:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TRUCKEE_GAUGE_PRESETS.map((preset) => {
                const active = usgsSiteNo === preset.siteNo;
                return (
                  <button
                    key={preset.siteNo}
                    type="button"
                    onClick={() => {
                      setUsgsSiteNo(preset.siteNo);
                      if (!waterBody) setWaterBody(preset.river);
                    }}
                    className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-teal-600 text-white border-teal-700 shadow-2xs'
                        : 'bg-slate-50 hover:bg-teal-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Nearby USGS Gauges dynamic search results */}
          {(gaugeSearchMessage || nearbyGauges.length > 0) && (
            <div className="rounded-xl bg-teal-50/70 border border-teal-200 p-3.5 space-y-2">
              {gaugeSearchMessage && (
                <p className="text-xs font-medium text-teal-900">{gaugeSearchMessage}</p>
              )}
              {nearbyGauges.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
                  {nearbyGauges.map((g) => {
                    const isSelected = usgsSiteNo === g.siteNo;
                    return (
                      <button
                        key={g.siteNo}
                        type="button"
                        onClick={() => setUsgsSiteNo(g.siteNo)}
                        className={`text-left p-2 rounded-lg border text-xs transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-teal-600 text-white border-teal-700 shadow-xs'
                            : 'bg-white hover:bg-teal-50 text-slate-800 border-teal-200'
                        }`}
                      >
                        <div className="flex items-center justify-between font-bold">
                          <span>#{g.siteNo}</span>
                          <span>
                            {g.distanceMiles !== undefined ? `${g.distanceMiles} mi` : ''}
                          </span>
                        </div>
                        <div className="truncate opacity-90">{g.siteName}</div>
                        <div className="mt-0.5 font-semibold">
                          {g.flowCfs !== null ? `${g.flowCfs.toLocaleString()} CFS` : 'Flow N/A'}
                          {g.gaugeHeightFt !== null ? ` • ${g.gaugeHeightFt} ft` : ''}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
              Wading Access, Ideal CFS Range &amp; Notes
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., Best wadeable flows 250–600 CFS at Boca gauge. Deep boulder pockets along the north bank..."
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
            />
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
              {initialLocation ? 'Update Location' : 'Save Location'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
