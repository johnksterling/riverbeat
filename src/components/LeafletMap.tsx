import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { Location, USGSGaugeInfo } from '../../shared/types.ts';

// Fix default Leaflet marker icons when bundled with Vite
const defaultIcon = L.divIcon({
  className: 'custom-fish-pin',
  html: `<div style="background-color:#0284c7;width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;">
    <div style="width:8px;height:8px;border-radius:50%;background:#ffffff;transform:rotate(45deg);"></div>
  </div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -28],
});

const selectedIcon = L.divIcon({
  className: 'custom-selected-pin',
  html: `<div style="background-color:#ea580c;width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #ffffff;box-shadow:0 3px 8px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;">
    <div style="width:10px;height:10px;border-radius:50%;background:#ffffff;transform:rotate(45deg);"></div>
  </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

const gaugeIcon = L.divIcon({
  className: 'custom-gauge-pin',
  html: `<div style="background-color:#0d9488;width:22px;height:22px;border-radius:50%;border:2px solid #ffffff;box-shadow:0 2px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;">G</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  popupAnchor: [0, -11],
});

export type MapLayerType = 'usgs_topo' | 'usgs_imagery' | 'osm';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TILE_LAYERS: Record<
  MapLayerType,
  { name: string; url: string; attribution: string; maxZoom: number }
> = {
  usgs_topo: {
    name: 'USGS Topo',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles courtesy of the <a href="https://usgs.gov/">U.S. Geological Survey</a>',
    maxZoom: 16,
  },
  usgs_imagery: {
    name: 'USGS Satellite + Topo',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles courtesy of the <a href="https://usgs.gov/">U.S. Geological Survey</a>',
    maxZoom: 16,
  },
  osm: {
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  },
};

interface LeafletMapProps {
  locations?: Location[];
  selectedLocationId?: number | null;
  onSelectLocation?: (location: Location) => void;
  pickerPosition?: { lat: number; lng: number } | null;
  onPickPosition?: (lat: number, lng: number) => void;
  nearbyGauges?: USGSGaugeInfo[];
  onSelectGauge?: (gauge: USGSGaugeInfo) => void;
  center?: [number, number];
  zoom?: number;
  heightClass?: string;
}

export const LeafletMap: React.FC<LeafletMapProps> = ({
  locations = [],
  selectedLocationId = null,
  onSelectLocation,
  pickerPosition = null,
  onPickPosition,
  nearbyGauges = [],
  onSelectGauge,
  center = [39.365, -120.11], // Truckee River Corridor (Tahoe City to Farad/Stateline)
  zoom = 10,
  heightClass = 'h-[420px]',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const pickerMarkerRef = useRef<L.Marker | null>(null);
  const [activeLayer, setActiveLayer] = useState<MapLayerType>('usgs_topo');

  // Initialize map instance once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center,
      zoom,
    });

    const initialConfig = TILE_LAYERS[activeLayer];
    const tileLayer = L.tileLayer(initialConfig.url, {
      attribution: initialConfig.attribution,
      maxZoom: initialConfig.maxZoom,
    }).addTo(map);

    const markersGroup = L.layerGroup().addTo(map);

    mapRef.current = map;
    tileLayerRef.current = tileLayer;
    markersLayerRef.current = markersGroup;

    // Slight delay invalidateSize so modals render tiles properly
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Switch tile layer when user toggles USGS Topo / Satellite / OSM
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    const cfg = TILE_LAYERS[activeLayer];
    tileLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
    }).addTo(map);
  }, [activeLayer]);

  // Handle click-to-pick mode (like original map_location.js)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onPickPosition) return;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      const lat = Math.round(e.latlng.lat * 100000) / 100000;
      const lng = Math.round(e.latlng.lng * 100000) / 100000;
      onPickPosition(lat, lng);
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [onPickPosition]);

  // Sync draggable picker marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!pickerPosition) {
      if (pickerMarkerRef.current) {
        map.removeLayer(pickerMarkerRef.current);
        pickerMarkerRef.current = null;
      }
      return;
    }

    if (!pickerMarkerRef.current) {
      const marker = L.marker([pickerPosition.lat, pickerPosition.lng], {
        draggable: Boolean(onPickPosition),
        icon: selectedIcon,
      }).addTo(map);

      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        if (onPickPosition) {
          onPickPosition(
            Math.round(pos.lat * 100000) / 100000,
            Math.round(pos.lng * 100000) / 100000
          );
        }
      });
      pickerMarkerRef.current = marker;
      map.setView([pickerPosition.lat, pickerPosition.lng], Math.max(map.getZoom(), 9));
    } else {
      pickerMarkerRef.current.setLatLng([pickerPosition.lat, pickerPosition.lng]);
    }
  }, [pickerPosition, onPickPosition]);

  // Render location markers & nearby USGS gauge markers
  useEffect(() => {
    const map = mapRef.current;
    const group = markersLayerRef.current;
    if (!map || !group) return;

    group.clearLayers();

    locations.forEach((loc) => {
      const isSelected = loc.id === selectedLocationId;
      const marker = L.marker([loc.latitude, loc.longitude], {
        icon: isSelected ? selectedIcon : defaultIcon,
        title: loc.name,
      });

      const starsHtml = loc.avg_score ? `★ ${loc.avg_score}/5` : 'No ratings yet';
      const popupDiv = document.createElement('div');
      popupDiv.className = 'text-sm min-w-[180px]';
      popupDiv.innerHTML = `
        <div style="font-weight:700;color:#0f172a;font-size:14px;margin-bottom:2px;">${escapeHtml(loc.name)}</div>
        ${
          loc.water_body
            ? `<div style="color:#0369a1;font-size:12px;font-weight:600;margin-bottom:4px;">${escapeHtml(loc.water_body)}</div>`
            : ''
        }
        <div style="color:#475569;font-size:12px;margin-bottom:4px;">
          ${loc.trip_count ?? 0} trip(s) &bull; <span style="color:#d97706;font-weight:600;">${starsHtml}</span>
        </div>
        ${
          loc.usgs_site_no
            ? `<div style="font-size:11px;color:#0d9488;margin-bottom:4px;">USGS Gauge #${escapeHtml(loc.usgs_site_no)}</div>`
            : ''
        }
      `;

      if (onSelectLocation) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Select Location';
        btn.style.cssText =
          'margin-top:4px;background:#0284c7;color:#fff;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;border:none;width:100%;';
        btn.onclick = () => {
          onSelectLocation(loc);
          marker.closePopup();
        };
        popupDiv.appendChild(btn);
      }

      marker.bindPopup(popupDiv);
      marker.on('click', () => {
        if (onSelectLocation) onSelectLocation(loc);
      });

      marker.addTo(group);
    });

    nearbyGauges.forEach((g) => {
      if (!g.latitude || !g.longitude) return;
      const gMarker = L.marker([g.latitude, g.longitude], {
        icon: gaugeIcon,
        title: `${g.siteName} (#${g.siteNo})`,
      });

      const gDiv = document.createElement('div');
      gDiv.innerHTML = `
        <div style="font-weight:700;font-size:13px;color:#0f766e;">USGS Gauge #${escapeHtml(g.siteNo)}</div>
        <div style="font-size:12px;color:#334155;margin:2px 0;">${escapeHtml(g.siteName)}</div>
        <div style="font-size:12px;color:#0f172a;font-weight:600;">
          ${g.flowCfs !== null ? `${g.flowCfs} CFS` : 'Flow N/A'}
          ${g.gaugeHeightFt !== null ? ` &bull; ${g.gaugeHeightFt} ft` : ''}
        </div>
      `;

      if (onSelectGauge) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Link This USGS Gauge';
        btn.style.cssText =
          'margin-top:6px;background:#0d9488;color:#fff;padding:4px 8px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;border:none;width:100%;';
        btn.onclick = () => {
          onSelectGauge(g);
          gMarker.closePopup();
        };
        gDiv.appendChild(btn);
      }

      gMarker.bindPopup(gDiv);
      gMarker.addTo(group);
    });
  }, [locations, selectedLocationId, onSelectLocation, nearbyGauges, onSelectGauge]);

  // Pan to selectedLocationId when changed externally
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedLocationId) return;
    const loc = locations.find((l) => l.id === selectedLocationId);
    if (loc) {
      map.flyTo([loc.latitude, loc.longitude], Math.max(map.getZoom(), 10), {
        duration: 0.6,
      });
    }
  }, [selectedLocationId, locations]);

  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-200 shadow-sm bg-slate-100">
      <div className="absolute top-3 right-3 z-20 flex bg-white/95 backdrop-blur-sm rounded-lg shadow-md border border-slate-200 p-1 gap-1 text-xs font-medium">
        {(Object.keys(TILE_LAYERS) as MapLayerType[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveLayer(key)}
            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
              activeLayer === key
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            {TILE_LAYERS[key].name}
          </button>
        ))}
      </div>
      <div ref={containerRef} className={`w-full ${heightClass}`} />
    </div>
  );
};
