import { describe, it, expect } from "vitest";
import {
  isPointInPolygon,
  findNearestAvailableDriver,
  type Driver,
} from "./core-logic";

describe("Core Business Logic", () => {
  it("Test 1 (Geofence Check): identifies points inside and outside the polygon", () => {
    const squarePolygon = [
      [10.0, 106.0],
      [10.0, 106.1],
      [10.1, 106.1],
      [10.1, 106.0],
    ];

    const insidePoint: [number, number] = [10.05, 106.05];
    const outsidePoint: [number, number] = [10.5, 106.5];

    expect(isPointInPolygon(insidePoint, squarePolygon)).toBe(true);
    expect(isPointInPolygon(outsidePoint, squarePolygon)).toBe(false);
  });

  it("Test 2 (Nearest Dispatch): skips a closer BUSY driver and picks the nearest IDLE one", () => {
    const pickup: [number, number] = [10.7769, 106.7009];

    const drivers: Driver[] = [
      { id: "busy-close", name: "Busy Close", lat: 10.777, lng: 106.7011, status: "BUSY", breached: false },
      { id: "idle-far", name: "Idle Far", lat: 10.85, lng: 106.85, status: "IDLE", breached: false },
      { id: "idle-near", name: "Idle Near", lat: 10.78, lng: 106.705, status: "IDLE", breached: false },
    ];

    const result = findNearestAvailableDriver(pickup, drivers);

    expect(result).not.toBeNull();
    expect(result?.driver.id).toBe("idle-near");
  });

  it("Test 3 (Edge Case - No Driver): returns null when every driver is BUSY", () => {
    const pickup: [number, number] = [10.7769, 106.7009];

    const drivers: Driver[] = [
      { id: "d1", name: "D1", lat: 10.777, lng: 106.701, status: "BUSY", breached: false },
      { id: "d2", name: "D2", lat: 10.78, lng: 106.705, status: "BUSY", breached: false },
    ];

    const result = findNearestAvailableDriver(pickup, drivers);

    expect(result).toBeNull();
  });
});
