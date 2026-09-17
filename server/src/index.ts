import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LatLng = [number, number]; // [lat, lng]

type DriverStatus = "IDLE" | "BUSY";

interface Driver {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: DriverStatus;
  breached: boolean;
}

interface GeofenceAlertPayload {
  driverId: string;
  message: string;
  timestamp: number;
}

interface RideDispatchedPayload {
  rideId: string;
  driverId: string;
  pickup: LatLng;
  distanceKm: number;
}

interface RequestRidePayload {
  pickup: LatLng;
}

interface TriggerBreachPayload {
  driverId: string;
}

type ServerMessage =
  | { type: "INIT_STATE"; payload: { drivers: Driver[]; geofence: number[][] } }
  | { type: "DRIVER_UPDATES"; payload: Driver[] }
  | { type: "GEOFENCE_ALERT"; payload: GeofenceAlertPayload }
  | { type: "RIDE_DISPATCHED"; payload: RideDispatchedPayload };

type ClientMessage =
  | { type: "REQUEST_RIDE"; payload: RequestRidePayload }
  | { type: "TRIGGER_BREACH"; payload: TriggerBreachPayload };

// ---------------------------------------------------------------------------
// Geofence: hexagon around District 1, Ho Chi Minh City ([lat, lng] pairs)
// ---------------------------------------------------------------------------

const GEOFENCE_CENTER: LatLng = [10.7769, 106.7009];

const GEOFENCE: number[][] = [
  [10.795, 106.685],
  [10.795, 106.715],
  [10.78, 106.725],
  [10.765, 106.715],
  [10.765, 106.685],
  [10.78, 106.675],
];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Standard ray-casting point-in-polygon test. `point` and `polygon` entries are [lat, lng]. */
function isPointInPolygon(point: LatLng, polygon: number[][]): boolean {
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
function haversineDistanceKm(a: LatLng, b: LatLng): number {
  const EARTH_RADIUS_KM = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const [lat1, lng1] = a;
  const [lat2, lng2] = b;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinDLng * sinDLng;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const DRIVER_NAMES = ["Minh", "Tuan", "Lan", "Huy", "Trang"];

function randomOffset(spread: number): number {
  return (Math.random() - 0.5) * spread;
}

function createInitialDrivers(): Driver[] {
  return DRIVER_NAMES.map((name, index) => ({
    id: `driver-${index + 1}`,
    name,
    lat: GEOFENCE_CENTER[0] + randomOffset(0.02),
    lng: GEOFENCE_CENTER[1] + randomOffset(0.02),
    status: Math.random() < 0.3 ? "BUSY" : "IDLE",
    breached: false,
  }));
}

const drivers: Driver[] = createInitialDrivers();

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

const PORT = 8080;

const httpServer = createServer();
const wss = new WebSocketServer({ server: httpServer });

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(message: ServerMessage): void {
  const raw = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(raw);
    }
  });
}

function broadcastDriverUpdates(): void {
  broadcast({ type: "DRIVER_UPDATES", payload: drivers });
}

/** Checks a driver's current position against the geofence and emits an alert on new breaches. */
function checkGeofence(driver: Driver): void {
  const inside = isPointInPolygon([driver.lat, driver.lng], GEOFENCE);

  if (!inside && !driver.breached) {
    driver.breached = true;
    broadcast({
      type: "GEOFENCE_ALERT",
      payload: {
        driverId: driver.id,
        message: `Driver ${driver.name} (${driver.id}) has left the geofence zone`,
        timestamp: Date.now(),
      },
    });
  } else if (inside && driver.breached) {
    driver.breached = false;
  }
}

wss.on("connection", (ws) => {
  console.log("Client connected");

  send(ws, {
    type: "INIT_STATE",
    payload: { drivers, geofence: GEOFENCE },
  });

  ws.on("message", (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      console.warn("Received malformed message:", raw.toString());
      return;
    }

    if (message.type === "REQUEST_RIDE") {
      handleRequestRide(message.payload);
    } else if (message.type === "TRIGGER_BREACH") {
      handleTriggerBreach(message.payload);
    }
  });

  ws.on("close", () => console.log("Client disconnected"));
});

function handleRequestRide(payload: RequestRidePayload): void {
  const { pickup } = payload;

  const idleDrivers = drivers.filter((d) => d.status === "IDLE");
  if (idleDrivers.length === 0) {
    console.warn("REQUEST_RIDE received but no IDLE drivers available");
    return;
  }

  let nearest = idleDrivers[0];
  let nearestDistance = haversineDistanceKm(pickup, [nearest.lat, nearest.lng]);

  for (const driver of idleDrivers.slice(1)) {
    const distance = haversineDistanceKm(pickup, [driver.lat, driver.lng]);
    if (distance < nearestDistance) {
      nearest = driver;
      nearestDistance = distance;
    }
  }

  nearest.status = "BUSY";

  broadcast({
    type: "RIDE_DISPATCHED",
    payload: {
      rideId: randomUUID(),
      driverId: nearest.id,
      pickup,
      distanceKm: Math.round(nearestDistance * 100) / 100,
    },
  });

  broadcastDriverUpdates();
}

function handleTriggerBreach(payload: TriggerBreachPayload): void {
  const driver = drivers.find((d) => d.id === payload.driverId);
  if (!driver) {
    console.warn(`TRIGGER_BREACH: unknown driver ${payload.driverId}`);
    return;
  }

  // Push the driver well outside the geofence bounding area to force a breach.
  driver.lat = GEOFENCE_CENTER[0] + 0.05 * (Math.random() < 0.5 ? -1 : 1);
  driver.lng = GEOFENCE_CENTER[1] + 0.05 * (Math.random() < 0.5 ? -1 : 1);

  checkGeofence(driver);
  broadcastDriverUpdates();
}

// ---------------------------------------------------------------------------
// Simulation loop: nudge driver positions every 1.5s and re-check geofence
// ---------------------------------------------------------------------------

const TICK_MS = 1500;
const MOVE_STEP = 0.0015;

setInterval(() => {
  for (const driver of drivers) {
    driver.lat += randomOffset(MOVE_STEP);
    driver.lng += randomOffset(MOVE_STEP);
    checkGeofence(driver);
  }

  broadcastDriverUpdates();
}, TICK_MS);

httpServer.listen(PORT, () => {
  console.log(`Mini Fleet server listening on ws://localhost:${PORT}`);
});
