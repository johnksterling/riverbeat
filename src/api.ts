import type {
  ConditionsLookupResult,
  Location,
  Trip,
  TripImage,
  USGSGaugeInfo,
} from '../shared/types.ts';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Locations
  getLocations(): Promise<Location[]> {
    return fetch('/api/locations').then((r) => handleResponse<Location[]>(r));
  },

  createLocation(data: Partial<Location>): Promise<Location> {
    return fetch('/api/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<Location>(r));
  },

  updateLocation(id: number, data: Partial<Location>): Promise<Location> {
    return fetch(`/api/locations/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<Location>(r));
  },

  deleteLocation(id: number): Promise<{ deleted: boolean; id: number }> {
    return fetch(`/api/locations/${id}`, {
      method: 'DELETE',
    }).then((r) => handleResponse<{ deleted: boolean; id: number }>(r));
  },

  // Trips
  getTrips(params?: {
    search?: string;
    location_id?: number | '';
    min_score?: number | '';
  }): Promise<Trip[]> {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.location_id) qs.set('location_id', String(params.location_id));
    if (params?.min_score) qs.set('min_score', String(params.min_score));
    const query = qs.toString();
    return fetch(`/api/trips${query ? `?${query}` : ''}`).then((r) =>
      handleResponse<Trip[]>(r)
    );
  },

  createTrip(data: Partial<Trip>): Promise<Trip> {
    return fetch('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<Trip>(r));
  },

  updateTrip(id: number, data: Partial<Trip>): Promise<Trip> {
    return fetch(`/api/trips/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<Trip>(r));
  },

  deleteTrip(id: number): Promise<{ deleted: boolean; id: number }> {
    return fetch(`/api/trips/${id}`, {
      method: 'DELETE',
    }).then((r) => handleResponse<{ deleted: boolean; id: number }>(r));
  },

  uploadTripImages(tripId: number, files: FileList | File[], caption = ''): Promise<TripImage[]> {
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append('images', file));
    if (caption) formData.append('caption', caption);
    return fetch(`/api/trips/${tripId}/images`, {
      method: 'POST',
      body: formData,
    }).then((r) => handleResponse<TripImage[]>(r));
  },

  deleteTripImage(tripId: number, imageId: number): Promise<{ deleted: boolean; id: number }> {
    return fetch(`/api/trips/${tripId}/images/${imageId}`, {
      method: 'DELETE',
    }).then((r) => handleResponse<{ deleted: boolean; id: number }>(r));
  },

  // USGS & Conditions
  getTruckeeWatershedFlows(): Promise<USGSGaugeInfo[]> {
    return fetch('/api/usgs/truckee-flows').then((r) => handleResponse<USGSGaugeInfo[]>(r));
  },

  findNearbyGauges(lat: number, lng: number): Promise<USGSGaugeInfo[]> {
    return fetch(`/api/usgs/nearby?lat=${lat}&lng=${lng}`).then((r) =>
      handleResponse<USGSGaugeInfo[]>(r)
    );
  },

  getUsgsSiteLive(siteNo: string, date?: string): Promise<USGSGaugeInfo> {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    return fetch(`/api/usgs/site/${encodeURIComponent(siteNo)}${qs}`).then((r) =>
      handleResponse<USGSGaugeInfo>(r)
    );
  },

  lookupConditions(params: {
    locationId?: number;
    lat?: number;
    lng?: number;
    usgsSiteNo?: string;
    date?: string;
  }): Promise<ConditionsLookupResult> {
    const qs = new URLSearchParams();
    if (params.locationId) qs.set('locationId', String(params.locationId));
    if (params.lat !== undefined) qs.set('lat', String(params.lat));
    if (params.lng !== undefined) qs.set('lng', String(params.lng));
    if (params.usgsSiteNo) qs.set('usgsSiteNo', params.usgsSiteNo);
    if (params.date) qs.set('date', params.date);
    return fetch(`/api/conditions/lookup?${qs.toString()}`).then((r) =>
      handleResponse<ConditionsLookupResult>(r)
    );
  },
};
