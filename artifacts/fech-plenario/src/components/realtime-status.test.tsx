import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RealtimeStatusBadge } from "./realtime-status-badge";
import { RealtimeOfflineNotice } from "./realtime-offline-notice";

vi.mock("@/lib/realtime", () => ({
  usesRealtimePolling: true,
  getSocket: () => { throw new Error("Polling UI must not open a socket"); },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("labels polling without showing a false connection failure", async () => {
  vi.useFakeTimers();
  render(<><RealtimeStatusBadge /><RealtimeOfflineNotice /></>);
  await vi.advanceTimersByTimeAsync(11000);
  expect(screen.getByRole("status").textContent).toBe("Actualización periódica");
  expect(screen.queryByRole("alert")).toBeNull();
});
