import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  isPointInPolygon,
  findNearestAvailableDriver,
  formatNoDriversLog,
  NO_AVAILABLE_DRIVERS_MESSAGE,
  type Driver,
  type Coordinates,
} from "./core-logic.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LatLng = Coordinates;

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

interface RideRejectedPayload {
  reason: string;
  timestamp: number;
}

interface TriggerBreachPayload {
  driverId: string;
}

type ServerMessage =
  | { type: "INIT_STATE"; payload: { drivers: Driver[]; geofence: number[][] } }
  | { type: "DRIVER_UPDATES"; payload: Driver[] }
  | { type: "GEOFENCE_ALERT"; payload: GeofenceAlertPayload }
  | { type: "RIDE_DISPATCHED"; payload: RideDispatchedPayload }
  | { type: "RIDE_REJECTED"; payload: RideRejectedPayload };

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

const PORT = Number(process.env.PORT) || 8080;

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
      handleRequestRide(ws, message.payload);
    } else if (message.type === "TRIGGER_BREACH") {
      handleTriggerBreach(message.payload);
    }
  });

  ws.on("close", () => console.log("Client disconnected"));
});

function handleRequestRide(ws: WebSocket, payload: RequestRidePayload): void {
  const { pickup } = payload;

  const result = findNearestAvailableDriver(pickup, drivers);
  if (!result) {
    console.error(formatNoDriversLog());
    send(ws, {
      type: "RIDE_REJECTED",
      payload: { reason: NO_AVAILABLE_DRIVERS_MESSAGE, timestamp: Date.now() },
    });
    return;
  }

  const { driver: nearest, distanceKm: nearestDistance } = result;
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
