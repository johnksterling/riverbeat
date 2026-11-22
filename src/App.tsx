import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  BookOpen,
  Bug,
  Calendar,
  Camera,
  Clock,
  CloudSun,
  Compass,
  Droplets,
  Edit3,
  Fish,
  Gauge,
  Loader2,
  LogOut,
  Map as MapIcon,
  MapPin,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Thermometer,
  Trash2,
  Waves,
  Wind,
  X,
} from 'lucide-react';
import type { AuthUserInfo, Location, Trip, USGSGaugeInfo } from '../shared/types.ts';
import {
  findNearestLocation,
  formatDuration,
  formatLocalDateTime,
  getTimeOfDayLabel,
} from '../shared/photoSessions.ts';
import { api, getAuthenticatedMediaUrl } from './api.ts';
import { StarRating } from './components/StarRating.tsx';
import { LeafletMap } from './components/LeafletMap.tsx';
import { LocationModal } from './components/LocationModal.tsx';
import { TripModal, type TripPrefillDraft } from './components/TripModal.tsx';
import { PhotoImportModal } from './components/PhotoImportModal.tsx';
import { GoogleSignInGate } from './components/GoogleSignInGate.tsx';

const ACTIVE_SESSION_KEY = 'riverbeat_active_session';

interface ActiveFishingSession {
  startedAt: string; // ISO string
  locationId: number | null;
  geoStatus: 'locating' | 'matched' | 'unavailable';
}

function formatElapsedTimer(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

type ActiveTab = 'trips' | 'locations' | 'map' | 'insights';

function formatTripDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function App() {
  const [authChecking, setAuthChecking] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUserInfo | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    const param = new URLSearchParams(window.location.search).get('tab');
    if (param === 'locations' || param === 'map' || param === 'insights' || param === 'trips') {
      return param;
    }
    return 'trips';
  });
  const [locations, setLocations] = useState<Location[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);

  // Live Truckee River Watershed USGS gauges bar
  const [truckeeGauges, setTruckeeGauges] = useState<USGSGaugeInfo[]>([]);
  const [loadingTruckeeFlows, setLoadingTruckeeFlows] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLocationId, setFilterLocationId] = useState<number | ''>('');
  const [filterMinScore, setFilterMinScore] = useState<number | ''>('');

  // Map selection
  const [selectedMapLocationId, setSelectedMapLocationId] = useState<number | null>(null);

  // Live USGS readings cache by siteNo
  const [liveReadings, setLiveReadings] = useState<Record<string, USGSGaugeInfo>>({});
  const [loadingGaugeSite, setLoadingGaugeSite] = useState<string | null>(null);

  // Modals
  const [tripModalOpen, setTripModalOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [tripPrefillDraft, setTripPrefillDraft] = useState<TripPrefillDraft | null>(null);
  const [preselectedTripLocationId, setPreselectedTripLocationId] = useState<number | null>(null);

  const [photoImportOpen, setPhotoImportOpen] = useState(false);

  // Quick Start / Stop Fishing Session Timer
  const [activeSession, setActiveSession] = useState<ActiveFishingSession | null>(() => {
    try {
      const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ActiveFishingSession;
      return parsed && parsed.startedAt ? parsed : null;
    } catch {
      return null;
    }
  });
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);

  // Lightbox photo
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const loadTruckeeWatershed = useCallback(async () => {
    setLoadingTruckeeFlows(true);
    try {
      const gauges = await api.getTruckeeWatershedFlows();
      setTruckeeGauges(gauges);
      const bySite: Record<string, USGSGaugeInfo> = {};
      for (const g of gauges) {
        bySite[g.siteNo] = g;
      }
      setLiveReadings((prev) => ({ ...prev, ...bySite }));
    } catch {
      // ignore if offline
    } finally {
      setLoadingTruckeeFlows(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [locs, trps] = await Promise.all([
        api.getLocations(),
        api.getTrips({
          search: searchQuery,
          location_id: filterLocationId,
          min_score: filterMinScore,
        }),
      ]);
      setLocations(locs);
      setTrips(trps);
    } catch (err) {
      console.error('Failed to load FishLog data:', err);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, filterLocationId, filterMinScore]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const cfg = await api.getAuthConfig();
        if (!active) return;
        setAuthRequired(cfg.authRequired);
        setGoogleClientId(cfg.googleClientId);
        if (cfg.authRequired) {
          const me = await api.getMe().catch(() => ({ user: null, authRequired: true }));
          if (!active) return;
          setCurrentUser(me.user);
        }
      } catch {
        // default to local mode if unreachable
      } finally {
        if (active) setAuthChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (authChecking) return;
    if (authRequired && !currentUser) return;
    loadAll();
  }, [loadAll, authChecking, authRequired, currentUser]);

  useEffect(() => {
    if (authChecking) return;
    if (authRequired && !currentUser) return;
    loadTruckeeWatershed();
  }, [loadTruckeeWatershed, authChecking, authRequired, currentUser]);

  useEffect(() => {
    if (!activeSession) {
      setElapsedMs(0);
      return;
    }
    const update = () => {
      setElapsedMs(Date.now() - new Date(activeSession.startedAt).getTime());
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [activeSession]);

  const persistActiveSession = (next: ActiveFishingSession | null) => {
    setActiveSession(next);
    if (next) {
      localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(next));
    } else {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
  };

  const handleStartSession = () => {
    const startedAt = new Date().toISOString();
    const initial: ActiveFishingSession = {
      startedAt,
      locationId: locations[0]?.id ?? null,
      geoStatus: typeof navigator !== 'undefined' && navigator.geolocation ? 'locating' : 'unavailable',
    };
    persistActiveSession(initial);

    if (typeof navigator !== 'undefined' && navigator.geolocation && locations.length > 0) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const nearest = findNearestLocation(
            pos.coords.latitude,
            pos.coords.longitude,
            locations,
            15
          );
          setActiveSession((prev) => {
            if (!prev || prev.startedAt !== startedAt) return prev;
            const updated: ActiveFishingSession = {
              ...prev,
              locationId: nearest ? nearest.location.id : prev.locationId,
              geoStatus: nearest ? 'matched' : 'unavailable',
            };
            localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(updated));
            return updated;
          });
        },
        () => {
          setActiveSession((prev) => {
            if (!prev || prev.startedAt !== startedAt) return prev;
            const updated: ActiveFishingSession = { ...prev, geoStatus: 'unavailable' };
            localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(updated));
            return updated;
          });
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
      );
    }
  };

  const handleStopSession = () => {
    if (!activeSession) return;
    const startDate = new Date(activeSession.startedAt);
    const durationMinutes = Math.max(1, Math.round((Date.now() - startDate.getTime()) / 60000));
    const matchedBeat = locations.find((l) => l.id === activeSession.locationId);
    const timeOfDay = getTimeOfDayLabel(startDate);
    const defaultTitle = matchedBeat
      ? `${timeOfDay} Session at ${matchedBeat.name}`
      : `${timeOfDay} Fly-Fishing Session`;

    setEditingTrip(null);
    setPreselectedTripLocationId(null);
    setTripPrefillDraft({
      description: defaultTitle,
      tripDate: formatLocalDateTime(startDate),
      durationMinutes,
      locationId: activeSession.locationId ?? locations[0]?.id ?? null,
      autoLookupOnMount: true,
    });
    persistActiveSession(null);
    setTripModalOpen(true);
  };

  const handleDiscardActiveSession = () => {
    if (elapsedMs > 60000 && !window.confirm('Discard the current active fishing session timer?')) {
      return;
    }
    persistActiveSession(null);
  };

  const handleCheckLiveFlow = async (siteNo: string) => {
    if (!siteNo) return;
    setLoadingGaugeSite(siteNo);
    try {
      const info = await api.getUsgsSiteLive(siteNo);
      setLiveReadings((prev) => ({ ...prev, [siteNo]: info }));
    } catch {
      // ignore if offline
    } finally {
      setLoadingGaugeSite(null);
    }
  };

  const handleDeleteTrip = async (trip: Trip) => {
    if (!window.confirm(`Are you sure you want to delete "${trip.description}"?`)) {
      return;
    }
    await api.deleteTrip(trip.id);
    await loadAll();
  };

  const handleDeleteLocation = async (loc: Location) => {
    const warning =
      loc.trip_count && loc.trip_count > 0
        ? `Are you sure you want to delete "${loc.name}" and its ${loc.trip_count} associated trip(s)?`
        : `Are you sure you want to delete "${loc.name}"?`;
    if (!window.confirm(warning)) {
      return;
    }
    await api.deleteLocation(loc.id);
    await loadAll();
  };

  // Summary metrics
  const stats = useMemo(() => {
    const totalTrips = trips.length;
    const totalFish = trips.reduce(
      (sum, t) => sum + t.catches.reduce((cSum, c) => cSum + (Number(c.count) || 0), 0),
      0
    );
    const avgRating =
      totalTrips > 0
        ? (trips.reduce((sum, t) => sum + t.score, 0) / totalTrips).toFixed(1)
        : '—';

    const speciesMap = new Map<string, { count: number; maxLength: number }>();
    const flyMap = new Map<string, number>();
    const rigMap = new Map<string, { sessions: number; fishCount: number }>();

    for (const t of trips) {
      const sessionFish = t.catches.reduce((s, c) => s + (Number(c.count) || 1), 0);
      if (t.rig_type && t.rig_type.trim()) {
        const rigKey = t.rig_type.trim();
        const curRig = rigMap.get(rigKey) ?? { sessions: 0, fishCount: 0 };
        curRig.sessions += 1;
        curRig.fishCount += sessionFish;
        rigMap.set(rigKey, curRig);
      }

      for (const c of t.catches) {
        const sp = c.species.trim();
        if (sp) {
          const cur = speciesMap.get(sp) ?? { count: 0, maxLength: 0 };
          cur.count += Number(c.count) || 1;
          if (c.length_inches && c.length_inches > cur.maxLength) {
            cur.maxLength = c.length_inches;
          }
          speciesMap.set(sp, cur);
        }
        const fly = c.fly_or_lure.trim();
        if (fly) {
          flyMap.set(fly, (flyMap.get(fly) ?? 0) + (Number(c.count) || 1));
        }
      }
    }

    const topSpecies = Array.from(speciesMap.entries())
      .map(([species, info]) => ({ species, ...info }))
      .sort((a, b) => b.count - a.count);

    const topFlies = Array.from(flyMap.entries())
      .map(([fly, count]) => ({ fly, count }))
      .sort((a, b) => b.count - a.count);

    const topRigs = Array.from(rigMap.entries())
      .map(([rig, info]) => ({ rig, ...info }))
      .sort((a, b) => b.fishCount - a.fishCount);

    return {
      totalTrips,
      totalFish,
      avgRating,
      topSpecies,
      topFlies,
      topRigs,
    };
  }, [trips]);

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
        <span className="text-sm font-medium">Loading RiverBeat...</span>
      </div>
    );
  }

  if (authRequired && !currentUser && googleClientId) {
    return (
      <GoogleSignInGate
        googleClientId={googleClientId}
        onSignedIn={(user) => setCurrentUser(user)}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Header & Navigation */}
      <header className="sticky top-0 z-30 bg-gradient-to-r from-slate-900 via-sky-950 to-teal-950 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4 py-3.5">
            {/* Brand */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-500/20 border border-teal-400/30 flex items-center justify-center shadow-inner">
                <Fish className="w-6 h-6 text-teal-300" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-extrabold tracking-tight text-white">
                    RiverBeat
                  </h1>
                  <span className="text-[11px] font-semibold uppercase tracking-wider bg-teal-500/20 text-teal-200 border border-teal-400/30 px-2 py-0.5 rounded-full">
                    Fly Fishing &amp; USGS Flows
                  </span>
                </div>
                <p className="text-xs text-sky-200/80">
                  Fly-Fishing Session Journal, River Beats &amp; Live USGS Gauge Tracker
                </p>
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav className="flex items-center gap-1 bg-slate-950/40 p-1 rounded-xl border border-white/10">
              <button
                type="button"
                onClick={() => setActiveTab('trips')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'trips'
                    ? 'bg-white text-slate-950 shadow-xs'
                    : 'text-sky-100 hover:bg-white/10'
                }`}
              >
                <BookOpen className="w-4 h-4" />
                Journal
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('locations')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'locations'
                    ? 'bg-white text-slate-950 shadow-xs'
                    : 'text-sky-100 hover:bg-white/10'
                }`}
              >
                <MapPin className="w-4 h-4" />
                River Beats
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('map')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'map'
                    ? 'bg-white text-slate-950 shadow-xs'
                    : 'text-sky-100 hover:bg-white/10'
                }`}
              >
                <MapIcon className="w-4 h-4" />
                Topo Map
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('insights')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === 'insights'
                    ? 'bg-white text-slate-950 shadow-xs'
                    : 'text-sky-100 hover:bg-white/10'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                Fly Box Stats
              </button>
            </nav>

            {/* Primary CTA Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              {activeSession ? (
                <button
                  type="button"
                  onClick={handleStopSession}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-rose-500 hover:bg-rose-400 text-white shadow-sm transition-colors cursor-pointer animate-pulse"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  Stop ({formatElapsedTimer(elapsedMs)})
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartSession}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-sm transition-colors cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Start Session
                </button>
              )}
              <button
                type="button"
                onClick={() => setPhotoImportOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-colors cursor-pointer"
                title="Derive fishing sessions from past photos using EXIF date & GPS"
              >
                <Camera className="w-4 h-4 text-sky-300" />
                <span className="hidden sm:inline">Import Photos</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingLocation(null);
                  setLocationModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-colors cursor-pointer"
              >
                <MapPin className="w-4 h-4 text-teal-300" />
                <span className="hidden md:inline">+ New Beat</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingTrip(null);
                  setTripPrefillDraft(null);
                  setPreselectedTripLocationId(null);
                  setTripModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-sm transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                Log Session
              </button>
              {authRequired && currentUser && (
                <button
                  type="button"
                  onClick={() => {
                    api.signOut();
                    setCurrentUser(null);
                  }}
                  title={`Signed in as ${currentUser.email} — Click to sign out`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-medium bg-white/10 hover:bg-white/20 text-sky-100 border border-white/10 transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="hidden md:inline">Sign Out</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Active Start/Stop Fishing Session Banner */}
        {activeSession && (
          <section className="rounded-2xl bg-gradient-to-r from-emerald-950 via-teal-900 to-sky-950 text-white p-4 shadow-md border border-emerald-500/30 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping shrink-0" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-300">
                    Fishing Session Active
                  </span>
                  <span className="font-mono text-lg font-extrabold text-white bg-white/10 px-2.5 py-0.5 rounded-lg">
                    {formatElapsedTimer(elapsedMs)}
                  </span>
                </div>
                <div className="text-xs text-sky-200 mt-0.5">
                  Started at{' '}
                  {new Date(activeSession.startedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {activeSession.geoStatus === 'locating' && ' • Matching GPS to River Beat...'}
                  {activeSession.geoStatus === 'matched' && ' • Beat matched via GPS'}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <select
                value={activeSession.locationId ?? ''}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : null;
                  persistActiveSession({ ...activeSession, locationId: val });
                }}
                className="rounded-xl bg-slate-900/70 border border-white/20 text-white text-xs font-semibold px-3 py-2 outline-none focus:border-emerald-400"
              >
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={handleStopSession}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-rose-500 hover:bg-rose-400 text-white shadow-sm transition-colors cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                Stop &amp; Log Session
              </button>

              <button
                type="button"
                onClick={handleDiscardActiveSession}
                title="Discard active session timer"
                className="p-2 rounded-xl text-sky-200 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </section>
        )}

        {/* Live Truckee River Watershed USGS Flow Bar */}
        <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Waves className="w-4 h-4 text-teal-600" />
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                Live Truckee &amp; Little Truckee USGS Stream Gauges
              </h2>
              <span className="text-[11px] text-slate-400 hidden sm:inline">
                (Tahoe City → Hwy 89 → Little Truckee → Boca/Hirschdale → Farad → Reno)
              </span>
            </div>
            <button
              type="button"
              onClick={loadTruckeeWatershed}
              disabled={loadingTruckeeFlows}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 px-2.5 py-1 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingTruckeeFlows ? 'animate-spin' : ''}`} />
              Refresh USGS Flows
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {truckeeGauges.map((g) => {
              const hotWater = g.waterTempF !== null && g.waterTempF >= 67;
              return (
                <div
                  key={g.siteNo}
                  className={`rounded-xl p-3 border transition-colors ${
                    hotWater
                      ? 'bg-amber-50/70 border-amber-300'
                      : 'bg-slate-50/80 border-slate-200/80 hover:border-teal-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-bold text-slate-800 truncate">
                      {g.shortLabel ?? g.siteName}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">#{g.siteNo}</span>
                  </div>

                  <div className="mt-1.5 flex items-baseline gap-2">
                    <span className="text-base font-extrabold text-teal-900">
                      {g.flowCfs !== null ? `${g.flowCfs.toLocaleString()} CFS` : '— CFS'}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-500">
                    <span>{g.gaugeHeightFt !== null ? `${g.gaugeHeightFt} ft` : ''}</span>
                    {g.waterTempF !== null && (
                      <span
                        className={`font-semibold ${
                          hotWater ? 'text-amber-700' : 'text-cyan-700'
                        }`}
                      >
                        {g.waterTempF}°F {hotWater ? '⚠️' : ''}
                      </span>
                    )}
                  </div>

                  {g.idealFlowRange && (
                    <div className="mt-1.5 pt-1.5 border-t border-slate-200/70 text-[10px] text-slate-500">
                      Prime Wading: <strong className="text-slate-700">{g.idealFlowRange}</strong>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Summary KPI Bar */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs flex items-center gap-3.5">
            <div className="p-3 rounded-xl bg-sky-50 text-sky-600">
              <Calendar className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Sessions Logged
              </div>
              <div className="text-2xl font-extrabold text-slate-900">{stats.totalTrips}</div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs flex items-center gap-3.5">
            <div className="p-3 rounded-xl bg-teal-50 text-teal-600">
              <Fish className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Trout &amp; Fish Landed
              </div>
              <div className="text-2xl font-extrabold text-slate-900">{stats.totalFish}</div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs flex items-center gap-3.5">
            <div className="p-3 rounded-xl bg-indigo-50 text-indigo-600">
              <Compass className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                River Beats
              </div>
              <div className="text-2xl font-extrabold text-slate-900">{locations.length}</div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs flex items-center gap-3.5">
            <div className="p-3 rounded-xl bg-amber-50 text-amber-500">
              <Award className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Avg Session Rating
              </div>
              <div className="text-2xl font-extrabold text-slate-900">{stats.avgRating} ★</div>
            </div>
          </div>
        </div>

        {/* ==================== TAB 1: TRIPS JOURNAL ==================== */}
        {activeTab === 'trips' && (
          <div className="space-y-5">
            {/* Search & Filter Bar */}
            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col md:flex-row items-stretch md:items-center gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search beats (Glenshire, Farad, Boca), rigs (Euro), hatches (BWO, PMD), or flies (Perdigon, Sculpzilla)..."
                  className="w-full pl-10 pr-8 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <select
                  value={filterLocationId}
                  onChange={(e) =>
                    setFilterLocationId(e.target.value ? Number(e.target.value) : '')
                  }
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-sky-500"
                >
                  <option value="">All River Beats</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>

                <select
                  value={filterMinScore}
                  onChange={(e) =>
                    setFilterMinScore(e.target.value ? Number(e.target.value) : '')
                  }
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-sky-500"
                >
                  <option value="">Any Rating</option>
                  <option value="5">5 Stars Only</option>
                  <option value="4">4+ Stars</option>
                  <option value="3">3+ Stars</option>
                </select>

                {(searchQuery || filterLocationId !== '' || filterMinScore !== '') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setFilterLocationId('');
                      setFilterMinScore('');
                    }}
                    className="text-xs font-semibold text-sky-700 hover:text-sky-900 px-2.5 py-2 cursor-pointer"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            </div>

            {/* Trips List */}
            {loading ? (
              <div className="flex items-center justify-center py-16 text-slate-500 gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-sky-600" />
                <span>Loading Truckee fishing log...</span>
              </div>
            ) : trips.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto">
                  <Fish className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-slate-900">No fly-fishing sessions found</h3>
                <p className="text-sm text-slate-500 max-w-md mx-auto">
                  {searchQuery || filterLocationId || filterMinScore
                    ? 'No sessions match your current search or filter criteria.'
                    : 'Start your Truckee River logbook by recording your first session!'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setEditingTrip(null);
                    setTripModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-sky-600 hover:bg-sky-700 text-white shadow-xs transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Log Session
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {trips.map((trip) => {
                  const hootOwl = trip.water_temp_f !== null && trip.water_temp_f >= 67;
                  return (
                    <article
                      key={trip.id}
                      className="bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-md transition-shadow overflow-hidden"
                    >
                      <div className="p-5 sm:p-6 space-y-4">
                        {/* Header Row */}
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                              <span className="inline-flex items-center gap-1 text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-md">
                                <Calendar className="w-3.5 h-3.5 text-sky-600" />
                                {formatTripDate(trip.trip_date)}
                              </span>
                              {trip.duration_minutes ? (
                                <span className="inline-flex items-center gap-1 text-teal-800 bg-teal-50 border border-teal-200/70 px-2 py-0.5 rounded-md">
                                  <Clock className="w-3 h-3 text-teal-600" />
                                  {formatDuration(trip.duration_minutes)}
                                </span>
                              ) : null}
                              {trip.location_name && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedMapLocationId(trip.location_id);
                                    setActiveTab('map');
                                  }}
                                  className="inline-flex items-center gap-1 text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200/80 px-2.5 py-0.5 rounded-md transition-colors cursor-pointer"
                                  title="View on Topo Map"
                                >
                                  <MapPin className="w-3.5 h-3.5" />
                                  {trip.location_name}
                                </button>
                              )}
                              {trip.location_water_body && (
                                <span className="text-slate-400">• {trip.location_water_body}</span>
                              )}
                            </div>
                            <h3 className="text-lg font-bold text-slate-900">{trip.description}</h3>
                          </div>

                          <div className="flex items-center gap-3">
                            <StarRating score={trip.score} size="md" />
                            <div className="flex items-center gap-1 border-l border-slate-200 pl-3">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingTrip(trip);
                                  setTripModalOpen(true);
                                }}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-sky-700 hover:bg-sky-50 transition-colors cursor-pointer"
                                title="Edit Session"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteTrip(trip)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                                title="Delete Session"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Rig, Hatches, USGS River & Weather Condition Pills */}
                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          {trip.rig_type && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-indigo-50 text-indigo-900 border border-indigo-200/80 px-2.5 py-1 rounded-lg">
                              🎣 {trip.rig_type}
                            </span>
                          )}
                          {trip.hatches && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-emerald-50 text-emerald-900 border border-emerald-200/80 px-2.5 py-1 rounded-lg">
                              <Bug className="w-3.5 h-3.5 text-emerald-600" />
                              {trip.hatches}
                            </span>
                          )}
                          {trip.water_clarity && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium bg-sky-50 text-sky-800 border border-sky-200/70 px-2.5 py-1 rounded-lg">
                              <Droplets className="w-3.5 h-3.5 text-sky-600" />
                              {trip.water_clarity}
                            </span>
                          )}
                          {trip.river_flow_cfs !== null && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-teal-50 text-teal-800 border border-teal-200/80 px-2.5 py-1 rounded-lg">
                              <Waves className="w-3.5 h-3.5 text-teal-600" />
                              {trip.river_flow_cfs.toLocaleString()} CFS
                            </span>
                          )}
                          {trip.gauge_height_ft !== null && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-teal-50/70 text-teal-800 border border-teal-200/60 px-2.5 py-1 rounded-lg">
                              <Gauge className="w-3.5 h-3.5 text-teal-600" />
                              {trip.gauge_height_ft} ft
                            </span>
                          )}
                          {trip.water_temp_f !== null && (
                            <span
                              className={`inline-flex items-center gap-1.5 text-xs font-semibold border px-2.5 py-1 rounded-lg ${
                                hootOwl
                                  ? 'bg-amber-100 text-amber-950 border-amber-300'
                                  : 'bg-cyan-50 text-cyan-800 border-cyan-200/80'
                              }`}
                            >
                              {hootOwl ? (
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                              ) : (
                                <Thermometer className="w-3.5 h-3.5 text-cyan-600" />
                              )}
                              Water {trip.water_temp_f}°F {hootOwl ? '(Hoot Owl)' : ''}
                            </span>
                          )}
                          {trip.weather_summary && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-amber-50/80 text-amber-900 border border-amber-200/70 px-2.5 py-1 rounded-lg">
                              <CloudSun className="w-3.5 h-3.5 text-amber-600" />
                              {trip.weather_summary}
                              {trip.air_temp_f !== null ? ` (${trip.air_temp_f}°F)` : ''}
                            </span>
                          )}
                          {trip.wind_mph !== null && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg">
                              <Wind className="w-3.5 h-3.5 text-slate-500" />
                              {trip.wind_mph} mph
                            </span>
                          )}
                          {trip.barometric_pressure !== null && (
                            <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
                              {trip.barometric_pressure} inHg
                            </span>
                          )}
                        </div>

                        {/* Comments */}
                        {trip.comments && (
                          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                            {trip.comments}
                          </p>
                        )}

                        {/* Catches List */}
                        {trip.catches && trip.catches.length > 0 && (
                          <div className="pt-2 border-t border-slate-100">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                              Trout Landed &amp; Winning Fly Patterns
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {trip.catches.map((c, idx) => (
                                <div
                                  key={c.id ?? idx}
                                  className="inline-flex items-center gap-2 bg-sky-50/70 border border-sky-200/70 rounded-xl px-3 py-1.5 text-xs"
                                >
                                  <span className="font-bold text-sky-950">
                                    {c.count}× {c.species}
                                  </span>
                                  {c.length_inches && (
                                    <span className="text-sky-800 font-semibold">
                                      {c.length_inches}&quot;
                                    </span>
                                  )}
                                  {c.weight_lbs && (
                                    <span className="text-sky-800 font-medium">
                                      ({c.weight_lbs} lbs)
                                    </span>
                                  )}
                                  {c.fly_or_lure && (
                                    <span className="bg-white text-slate-700 border border-sky-200 px-2 py-0.5 rounded-md font-medium">
                                      🪰 {c.fly_or_lure}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Photos */}
                        {trip.images && trip.images.length > 0 && (
                          <div className="flex flex-wrap gap-2.5 pt-2">
                            {trip.images.map((img) => (
                              <button
                                key={img.id}
                                type="button"
                                onClick={() => setLightboxUrl(getAuthenticatedMediaUrl(img.url))}
                                className="w-24 h-20 rounded-xl overflow-hidden border border-slate-200 hover:ring-2 hover:ring-sky-500 transition-all cursor-pointer"
                              >
                                <img
                                  src={getAuthenticatedMediaUrl(img.url)}
                                  alt={img.caption || trip.description}
                                  className="w-full h-full object-cover"
                                />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ==================== TAB 2: LOCATIONS DIRECTORY ==================== */}
        {activeTab === 'locations' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Truckee &amp; Little Truckee River Beats
                </h2>
                <p className="text-xs text-slate-500">
                  Manage your access spots, wadeable CFS notes, GPS pins, and linked USGS stream gauges
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingLocation(null);
                  setLocationModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-sky-600 hover:bg-sky-700 text-white shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Add River Beat
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {locations.map((loc) => {
                const live = loc.usgs_site_no ? liveReadings[loc.usgs_site_no] : undefined;
                return (
                  <div
                    key={loc.id}
                    className="bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-md transition-shadow p-5 flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-bold text-slate-900 text-base">{loc.name}</h3>
                          {loc.water_body && (
                            <div className="text-xs font-semibold text-sky-700">
                              {loc.water_body}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingLocation(loc);
                              setLocationModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-sky-700 hover:bg-sky-50 transition-colors cursor-pointer"
                            title="Edit Beat"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteLocation(loc)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                            title="Delete Beat"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono">
                        <span className="bg-slate-100 px-2 py-0.5 rounded-md">
                          {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                        </span>
                        {loc.usgs_site_no && (
                          <span className="bg-teal-50 text-teal-800 border border-teal-200 px-2 py-0.5 rounded-md font-sans font-semibold">
                            USGS #{loc.usgs_site_no}
                          </span>
                        )}
                      </div>

                      {loc.notes && (
                        <p className="text-xs text-slate-600 line-clamp-3 leading-relaxed">
                          {loc.notes}
                        </p>
                      )}

                      {/* Live USGS Flow Check */}
                      {loc.usgs_site_no && (
                        <div className="pt-1">
                          {live && (live.flowCfs !== null || live.gaugeHeightFt !== null) ? (
                            <div className="rounded-xl bg-teal-50/90 border border-teal-200 p-2.5 text-xs space-y-1">
                              <div className="flex items-center justify-between font-bold text-teal-950">
                                <span className="flex items-center gap-1">
                                  <Waves className="w-3.5 h-3.5 text-teal-600" />
                                  Live Gauge #{loc.usgs_site_no}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleCheckLiveFlow(loc.usgs_site_no)}
                                  className="text-[11px] text-teal-700 underline cursor-pointer"
                                >
                                  Refresh
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-3 font-semibold text-teal-900">
                                {live.flowCfs !== null && (
                                  <span>{live.flowCfs.toLocaleString()} CFS</span>
                                )}
                                {live.gaugeHeightFt !== null && (
                                  <span>{live.gaugeHeightFt} ft</span>
                                )}
                                {live.waterTempF !== null && <span>{live.waterTempF}°F</span>}
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleCheckLiveFlow(loc.usgs_site_no)}
                              disabled={loadingGaugeSite === loc.usgs_site_no}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200/80 px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {loadingGaugeSite === loc.usgs_site_no ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Radio className="w-3.5 h-3.5 text-teal-600" />
                              )}
                              Check Current USGS Flow
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                      <div className="text-xs text-slate-500">
                        <span className="font-bold text-slate-800">{loc.trip_count ?? 0}</span>{' '}
                        sessions
                        {loc.avg_score ? (
                          <span className="ml-2 text-amber-600 font-bold">★ {loc.avg_score}</span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedMapLocationId(loc.id);
                            setActiveTab('map');
                          }}
                          className="text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                        >
                          Topo Map
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTrip(null);
                            setPreselectedTripLocationId(loc.id);
                            setTripModalOpen(true);
                          }}
                          className="text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200/80 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                        >
                          + Log Session
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ==================== TAB 3: MAP EXPLORER ==================== */}
        {activeTab === 'map' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2">
              <LeafletMap
                locations={locations}
                selectedLocationId={selectedMapLocationId}
                onSelectLocation={(loc) => setSelectedMapLocationId(loc.id)}
                center={[39.365, -120.11]}
                zoom={10}
                heightClass="h-[560px]"
              />
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 flex flex-col h-[560px]">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Truckee Corridor Beats</h3>
                  <p className="text-xs text-slate-500">
                    Click any beat to zoom to its USGS Topo contour
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingLocation(null);
                    setLocationModalOpen(true);
                  }}
                  className="text-xs font-semibold text-sky-600 hover:text-sky-800 inline-flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Beat
                </button>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-slate-100 pr-1 mt-2">
                {locations.map((loc) => {
                  const isSelected = loc.id === selectedMapLocationId;
                  return (
                    <div
                      key={loc.id}
                      onClick={() => setSelectedMapLocationId(loc.id)}
                      className={`p-3 rounded-xl transition-colors cursor-pointer my-1 ${
                        isSelected
                          ? 'bg-sky-50 border border-sky-200'
                          : 'hover:bg-slate-50 border border-transparent'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-sm text-slate-900">{loc.name}</div>
                          {loc.water_body && (
                            <div className="text-xs font-medium text-sky-700">{loc.water_body}</div>
                          )}
                        </div>
                        {loc.avg_score && (
                          <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">
                            ★ {loc.avg_score}
                          </span>
                        )}
                      </div>

                      {loc.notes && (
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{loc.notes}</p>
                      )}

                      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-100 text-xs">
                        <span className="text-slate-500">{loc.trip_count ?? 0} session(s)</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFilterLocationId(loc.id);
                              setActiveTab('trips');
                            }}
                            className="text-slate-600 hover:text-sky-700 font-medium cursor-pointer"
                          >
                            View Log
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingTrip(null);
                              setPreselectedTripLocationId(loc.id);
                              setTripModalOpen(true);
                            }}
                            className="text-sky-700 font-semibold hover:underline cursor-pointer"
                          >
                            + Log Session
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 4: FLY BOX STATS & INSIGHTS ==================== */}
        {activeTab === 'insights' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Top Flies */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-500" />
                <h3 className="font-bold text-slate-900">Top Producing Truckee Flies</h3>
              </div>
              {stats.topFlies.length === 0 ? (
                <p className="text-sm text-slate-500">No fly patterns recorded yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {stats.topFlies.map((f) => (
                    <div
                      key={f.fly}
                      className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100"
                    >
                      <span className="font-semibold text-xs sm:text-sm text-slate-800">
                        🪰 {f.fly}
                      </span>
                      <span className="text-xs font-bold text-amber-900 bg-amber-100 px-2.5 py-1 rounded-lg shrink-0">
                        {f.count} fish
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Catches by Rig / Technique */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center gap-2">
                <Bug className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-slate-900">Success by Rig / Technique</h3>
              </div>
              {stats.topRigs.length === 0 ? (
                <p className="text-sm text-slate-500">No rig techniques recorded yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {stats.topRigs.map((r) => (
                    <div
                      key={r.rig}
                      className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100"
                    >
                      <div>
                        <div className="font-bold text-sm text-slate-900">{r.rig}</div>
                        <div className="text-xs text-slate-500">{r.sessions} session(s)</div>
                      </div>
                      <span className="text-xs font-extrabold text-indigo-900 bg-indigo-100 px-2.5 py-1 rounded-lg">
                        {r.fishCount} landed
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Species Breakdown */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center gap-2">
                <Fish className="w-5 h-5 text-sky-600" />
                <h3 className="font-bold text-slate-900">Trout &amp; Species Breakdown</h3>
              </div>
              {stats.topSpecies.length === 0 ? (
                <p className="text-sm text-slate-500">No catches recorded yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {stats.topSpecies.map((sp) => (
                    <div
                      key={sp.species}
                      className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100"
                    >
                      <div>
                        <div className="font-bold text-sm text-slate-900">{sp.species}</div>
                        {sp.maxLength > 0 && (
                          <div className="text-xs text-slate-500">
                            Best Landed: <strong>{sp.maxLength}&quot;</strong>
                          </div>
                        )}
                      </div>
                      <span className="text-xs font-extrabold text-sky-800 bg-sky-100 px-3 py-1 rounded-lg">
                        {sp.count} landed
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Locations Ranked by Rating */}
            <div className="md:col-span-3 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center gap-2">
                <Waves className="w-5 h-5 text-teal-600" />
                <h3 className="font-bold text-slate-900">Truckee Watershed Beats Summary</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                      <th className="py-2.5 pr-4">River Beat</th>
                      <th className="py-2.5 px-4">Water Body</th>
                      <th className="py-2.5 px-4">USGS Gauge</th>
                      <th className="py-2.5 px-4">Sessions</th>
                      <th className="py-2.5 pl-4">Avg Rating</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {locations.map((loc) => (
                      <tr key={loc.id} className="hover:bg-slate-50">
                        <td className="py-3 pr-4 font-bold text-slate-900">{loc.name}</td>
                        <td className="py-3 px-4 text-slate-600">{loc.water_body || '—'}</td>
                        <td className="py-3 px-4 font-mono text-xs text-teal-700">
                          {loc.usgs_site_no ? `#${loc.usgs_site_no}` : '—'}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-700">
                          {loc.trip_count ?? 0}
                        </td>
                        <td className="py-3 pl-4">
                          {loc.avg_score ? (
                            <div className="flex items-center gap-2">
                              <StarRating score={loc.avg_score} size="sm" />
                              <span className="text-xs font-bold text-slate-700">
                                {loc.avg_score}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">No sessions</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      {tripModalOpen && (
        <TripModal
          initialTrip={editingTrip}
          prefillDraft={tripPrefillDraft}
          locations={locations}
          preselectedLocationId={preselectedTripLocationId}
          onClose={() => {
            setTripModalOpen(false);
            setEditingTrip(null);
            setTripPrefillDraft(null);
          }}
          onSaved={async () => {
            setTripModalOpen(false);
            setEditingTrip(null);
            setTripPrefillDraft(null);
            await loadAll();
          }}
          onRequestNewLocation={() => {
            setTripModalOpen(false);
            setEditingLocation(null);
            setLocationModalOpen(true);
          }}
        />
      )}

      {photoImportOpen && (
        <PhotoImportModal
          locations={locations}
          onClose={() => setPhotoImportOpen(false)}
          onImported={async () => {
            setPhotoImportOpen(false);
            await loadAll();
          }}
        />
      )}

      {locationModalOpen && (
        <LocationModal
          initialLocation={editingLocation}
          onClose={() => {
            setLocationModalOpen(false);
            setEditingLocation(null);
          }}
          onSaved={async (savedLoc) => {
            setLocationModalOpen(false);
            setEditingLocation(null);
            await loadAll();
            setSelectedMapLocationId(savedLoc.id);
          }}
        />
      )}

      {/* Photo Lightbox */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <img
            src={lightboxUrl}
            alt="Trip full view"
            className="max-w-full max-h-[90vh] rounded-2xl shadow-2xl border border-white/15"
          />
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-5 right-5 bg-white/10 hover:bg-white/20 text-white p-2 rounded-full cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      )}
    </div>
  );
}
export default App;
