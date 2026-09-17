# Mini Fleet

Mini Fleet is a real-time dispatch and geofencing simulator for a small taxi fleet in District 1, Ho Chi Minh City. It tackles two classic ride-hailing problems — matching a rider with the nearest available driver, and detecting the instant a driver leaves an approved operating zone — by streaming live driver state from a WebSocket server straight to an interactive React/Leaflet map.

## Demo

![Mini Fleet Dashboard](docs/demo.png)

*The live map with color-coded driver markers (idle, busy, geofence breach), a pickup selector, and a real-time event log sidebar. Replace the placeholder above with an actual screenshot or GIF of the app running.*

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (client & server) | End-to-end type safety for the shared WebSocket message contract, without needing a shared package |
| Server | Node.js + [`ws`](https://github.com/websockets/ws) | The app is purely event/broadcast driven — a full HTTP framework would be overhead for something that just pushes state to connected clients |
| Client | React 18 + Vite | Fast dev server and HMR, ideal for quickly iterating on a map-heavy UI |
| Mapping | Leaflet + react-leaflet | Free OpenStreetMap tiles with no API key or billing setup, unlike Google Maps |
| Styling | Tailwind CSS | Utility-first classes kept UI iteration fast without hand-rolled CSS |
| Testing | Vitest | Lightweight, fast test runner for the pure business-logic module |

## Key Features

- **Live fleet simulation** — 5 named drivers move around the map with randomized position updates broadcast every 1.5 seconds
- **Real-time map visualization** — driver markers are color-coded by state (idle, busy, geofence breach) with a pulsing animation on breach
- **Geofencing engine** — a ray-casting point-in-polygon check watches every driver on every tick and fires an alert the instant one crosses the District 1 zone boundary in either direction
- **Nearest-driver dispatch** — clicking a pickup point on the map finds the closest *idle* driver using the Haversine great-circle distance formula and dispatches them
- **Manual breach trigger** — a "Trigger Test Breach" control lets you exercise the alert path on demand, without waiting for a random walk to leave the zone
- **Live activity log** — a sidebar stream of the last 100 events (alerts, dispatches, connection changes), color-coded by type
- **Connection status indicator** — a simple dot showing whether the client is currently connected to the WebSocket server
- **Unit-tested core logic** — geofencing, distance calculation, and driver matching live in a pure, I/O-free module so they can be tested without mocking WebSockets or timers

## Getting Started

The project is a simple two-package setup — a WebSocket server and a Vite/React client — with no database or environment variables to configure.

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd mini-fleet
   ```

2. **Start the server** (WebSocket, port `8080`)
   ```bash
   cd server
   npm install
   npm run dev
   ```

3. **Start the client** (Vite dev server, port `5173`), in a second terminal
   ```bash
   cd client
   npm install
   npm run dev
   ```

4. **Open the app** at [http://localhost:5173](http://localhost:5173). The client connects to the server automatically over `ws://localhost:8080`.

5. **Run the tests** for the server's core dispatch/geofencing logic
   ```bash
   cd server
   npm test
   ```

6. **Build for production**, from either `server/` or `client/`
   ```bash
   npm run build
   ```

## What I Learned

- **Separating pure logic from I/O pays off immediately.** Pulling the geofence check, distance calculation, and driver-matching logic out of the WebSocket handler and into a standalone module made it possible to unit-test the entire dispatch algorithm without mocking sockets or timers.
- **Simple geometry problems have elegant, well-known solutions.** Ray casting turned out to be a clean way to test whether a point lies inside an arbitrary polygon, and the Haversine formula gave accurate real-world distances between GPS coordinates on a sphere — no external geo library needed.
- **A small, explicit message contract keeps client and server honest.** Defining a handful of typed WebSocket message types (`INIT_STATE`, `DRIVER_UPDATES`, `GEOFENCE_ALERT`, `RIDE_DISPATCHED`, `REQUEST_RIDE`, `TRIGGER_BREACH`) made the real-time protocol easy to reason about on both ends, even without a formal schema.
- **React can stay in sync with server-pushed state without extra tooling.** Driving all UI updates from WebSocket messages into local component state was enough to keep the map, driver markers, and event log consistent in real time — no external state-management library required.
