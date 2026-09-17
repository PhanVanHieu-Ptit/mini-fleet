import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Polygon, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";

// ---------------------------------------------------------------------------
// Types (mirrors the server's WebSocket contract)
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

type ServerMessage =
  | { type: "INIT_STATE"; payload: { drivers: Driver[]; geofence: number[][] } }
  | { type: "DRIVER_UPDATES"; payload: Driver[] }
  | { type: "GEOFENCE_ALERT"; payload: GeofenceAlertPayload }
  | { type: "RIDE_DISPATCHED"; payload: RideDispatchedPayload };

interface LogEvent {
  id: string;
  kind: "alert" | "dispatch" | "info";
  message: string;
  timestamp: number;
}

const WS_URL = "ws://localhost:8080";
const DEFAULT_CENTER: LatLng = [10.7769, 106.7009];

// ---------------------------------------------------------------------------
// Leaflet divIcon helpers (inline SVG/HTML only — no default marker images)
// ---------------------------------------------------------------------------

function buildDriverIcon(driver: Driver): L.DivIcon {
  const color = driver.breached ? "#ef4444" : driver.status === "IDLE" ? "#22c55e" : "#eab308";
  const pulseClass = driver.breached ? "driver-marker-breached" : "";

  const html = `
    <div class="${pulseClass}" style="
      width: 20px;
      height: 20px;
      border-radius: 9999px;
      background: ${color};
      border: 2px solid white;
      box-shadow: 0 0 6px rgba(0,0,0,0.6);
    "></div>
  `;

  return L.divIcon({
    html,
    className: "",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function buildSelectedPointIcon(): L.DivIcon {
  const html = `
    <div style="
      width: 16px;
      height: 16px;
      border-radius: 9999px;
      background: #3b82f6;
      border: 2px solid white;
      box-shadow: 0 0 6px rgba(0,0,0,0.6);
    "></div>
  `;

  return L.divIcon({
    html,
    className: "",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

// ---------------------------------------------------------------------------
// Map click handler (child component so it can use react-leaflet hooks)
// ---------------------------------------------------------------------------

function MapClickHandler({ onSelect }: { onSelect: (point: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onSelect([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [geofence, setGeofence] = useState<number[][]>([]);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<LatLng | null>(null);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  const pushEvent = useCallback((kind: LogEvent["kind"], message: string, timestamp?: number) => {
    setEvents((prev) =>
      [
        { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind, message, timestamp: timestamp ?? Date.now() },
        ...prev,
      ].slice(0, 100)
    );
  }, []);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      pushEvent("info", "Connected to fleet server");
    };

    ws.onclose = () => {
      setConnected(false);
      pushEvent("info", "Disconnected from fleet server");
    };

    ws.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (message.type) {
        case "INIT_STATE":
          setDrivers(message.payload.drivers);
          setGeofence(message.payload.geofence);
          break;
        case "DRIVER_UPDATES":
          setDrivers(message.payload);
          break;
        case "GEOFENCE_ALERT":
          pushEvent("alert", message.payload.message, message.payload.timestamp);
          break;
        case "RIDE_DISPATCHED":
          pushEvent(
            "dispatch",
            `Ride ${message.payload.rideId.slice(0, 8)} dispatched to ${message.payload.driverId} (${message.payload.distanceKm} km)`
          );
          break;
      }
    };

    return () => {
      ws.close();
    };
  }, [pushEvent]);

  const sendMessage = useCallback((type: string, payload: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
  }, []);

  const handleTriggerBreach = useCallback(() => {
    if (drivers.length === 0) return;
    const candidates = drivers.filter((d) => !d.breached);
    const pool = candidates.length > 0 ? candidates : drivers;
    const target = pool[Math.floor(Math.random() * pool.length)];
    sendMessage("TRIGGER_BREACH", { driverId: target.id });
  }, [drivers, sendMessage]);

  const handleRequestRide = useCallback(() => {
    if (!selectedPoint) return;
    sendMessage("REQUEST_RIDE", { pickup: selectedPoint });
  }, [selectedPoint, sendMessage]);

  const polygonPositions = useMemo<[number, number][]>(
    () => geofence.map(([lat, lng]) => [lat, lng]),
    [geofence]
  );

  return (
    <div className="flex h-screen w-screen bg-slate-900 text-slate-100">
      <div className="relative flex-1">
        <MapContainer center={DEFAULT_CENTER} zoom={14} className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {polygonPositions.length > 0 && (
            <Polygon
              positions={polygonPositions}
              pathOptions={{ color: "#f97316", weight: 3, dashArray: "8 6", fillColor: "#f97316", fillOpacity: 0.05 }}
            />
          )}

          {drivers.map((driver) => (
            <Marker key={driver.id} position={[driver.lat, driver.lng]} icon={buildDriverIcon(driver)} />
          ))}

          {selectedPoint && <Marker position={selectedPoint} icon={buildSelectedPointIcon()} />}

          <MapClickHandler onSelect={setSelectedPoint} />
        </MapContainer>

        <div className="absolute left-3 top-3 z-[1000] flex items-center gap-2 rounded-md bg-slate-900/80 px-3 py-1.5 text-xs shadow">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
          {connected ? "Connected" : "Disconnected"}
        </div>
      </div>

      <aside className="flex w-[340px] flex-shrink-0 flex-col gap-4 border-l border-slate-800 bg-slate-950 p-4">
        <div>
          <h1 className="text-lg font-semibold">Mini Fleet Dispatch</h1>
          <p className="text-xs text-slate-400">Geofencing Engine — District 1, HCMC</p>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Selected pickup point</span>
          <span className="font-mono text-sm">
            {selectedPoint ? `${selectedPoint[0].toFixed(5)}, ${selectedPoint[1].toFixed(5)}` : "Click on the map to select"}
          </span>
          <button
            onClick={handleRequestRide}
            disabled={!selectedPoint}
            className="mt-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium transition enabled:hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
          >
            Request Ride at Selected Point
          </button>
        </div>

        <button
          onClick={handleTriggerBreach}
          disabled={drivers.length === 0}
          className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium transition enabled:hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
        >
          Trigger Test Breach
        </button>

        <div className="flex flex-1 flex-col gap-2 overflow-hidden">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Event stream</span>
          <div className="flex-1 space-y-2 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-2">
            {events.length === 0 && <p className="p-2 text-xs text-slate-500">No events yet.</p>}
            {events.map((event) => (
              <div
                key={event.id}
                className={`rounded-md border-l-4 px-2 py-1.5 text-xs ${
                  event.kind === "alert"
                    ? "border-red-500 bg-red-500/10 text-red-200"
                    : event.kind === "dispatch"
                    ? "border-green-500 bg-green-500/10 text-green-200"
                    : "border-slate-600 bg-slate-800/50 text-slate-300"
                }`}
              >
                <div className="font-mono text-[10px] opacity-70">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </div>
                <div>{event.message}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1 rounded-lg border border-slate-800 bg-slate-900 p-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-green-500" /> IDLE
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" /> BUSY
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Geofence breach
          </div>
        </div>
      </aside>
    </div>
  );
}
