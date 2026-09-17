// ---------------------------------------------------------------------------
// Pure business logic — no I/O, no WebSocket, no server state.
// Safe to unit test directly, with no mocking required.
// ---------------------------------------------------------------------------

export type Coordinates = [number, number]; // [lat, lng]

export type DriverStatus = "IDLE" | "BUSY";

export interface Driver {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: DriverStatus;
  breached: boolean;
}

/** Standard ray-casting point-in-polygon test. `point` and `polygon` entries are [lat, lng]. */
export function isPointInPolygon(point: Coordinates, polygon: number[][]): boolean {
  const [y, x] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];

    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

/** Haversine great-circle distance in kilometers between two [lat, lng] points. */
export function calculateHaversineDistance(coord1: Coordinates, coord2: Coordinates): number {
  const EARTH_RADIUS_KM = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const [lat1, lng1] = coord1;
  const [lat2, lng2] = coord2;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinDLng * sinDLng;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Finds the nearest IDLE driver to a pickup point. Returns null when none are available. */
export function findNearestAvailableDriver(
  pickup: Coordinates,
  drivers: Driver[]
): { driver: Driver; distanceKm: number } | null {
  const idleDrivers = drivers.filter((d) => d.status === "IDLE");
  if (idleDrivers.length === 0) return null;

  let nearest = idleDrivers[0];
  let nearestDistance = calculateHaversineDistance(pickup, [nearest.lat, nearest.lng]);

  for (const driver of idleDrivers.slice(1)) {
    const distance = calculateHaversineDistance(pickup, [driver.lat, driver.lng]);
    if (distance < nearestDistance) {
      nearest = driver;
      nearestDistance = distance;
    }
  }

  return { driver: nearest, distanceKm: nearestDistance };
}
