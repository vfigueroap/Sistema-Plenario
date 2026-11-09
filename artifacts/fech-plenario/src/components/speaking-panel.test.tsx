import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SpeakingPanel } from "./speaking-panel";

afterEach(() => { vi.unstubAllGlobals(); });

it("solo descarga los catálogos administrativos para la Mesa", async () => {
  const fetchData = vi.fn(async (_input: RequestInfo | URL) => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchData);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10000 } } });
  const panel = (isAdmin: boolean) => (
    <QueryClientProvider client={client}>
      <SpeakingPanel sessionId={1} agenda={[]} isAdmin={isAdmin} currentUserId={1} />
    </QueryClientProvider>
  );
  const view = render(panel(false));
  await waitFor(() => expect(fetchData).toHaveBeenCalledTimes(1));
  await act(async () => { await client.refetchQueries({ type: "active" }); });
  expect(fetchData.mock.calls.every(([path]) => path === "/api/sessions/1/speaking-turns")).toBe(true);
  view.rerender(panel(true));
  await waitFor(() => {
    const paths = fetchData.mock.calls.map(([path]) => String(path));
    expect(paths).toContain("/api/unidades-academicas");
    expect(paths).toContain("/api/regular-speakers");
  });
  view.unmount();
  client.clear();
});
