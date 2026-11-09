import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TopicBallotDetails } from "./topic-ballot-details";

vi.mock("@/hooks/use-realtime-status", () => ({ useRealtimeStatus: () => "polling" }));

afterEach(() => { vi.unstubAllGlobals(); });

it("no descarga seis detalles plegados y deja de consultar el detalle al cerrarlo", async () => {
  const fetchBallots = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ members: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchBallots);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10000 } } });
  const view = render(
    <QueryClientProvider client={client}>
      {Array.from({ length: 6 }, (_, i) => <TopicBallotDetails key={i} sessionId={1} topic={{ id: i + 1, title: `Moción ficticia ${i + 1}`, status: "abierto" }} />)}
    </QueryClientProvider>,
  );
  await act(async () => { await client.refetchQueries({ type: "active" }); });
  expect(fetchBallots).not.toHaveBeenCalled();
  const details = screen.getByText("Moción ficticia 1").closest("details")!;
  fireEvent.click(details.querySelector("summary")!);
  await waitFor(() => expect(fetchBallots).toHaveBeenCalledTimes(1));
  expect(String(fetchBallots.mock.calls[0][0])).toBe("/api/topics/1/ballots");
  await screen.findByText("Ordenar:");
  expect(screen.getByText(/recuento no es definitivo/)).toBeInTheDocument();
  fireEvent.click(details.querySelector("summary")!);
  await waitFor(() => expect(screen.queryByText("Ordenar:")).not.toBeInTheDocument());
  await act(async () => { await client.invalidateQueries({ refetchType: "active" }); });
  expect(fetchBallots).toHaveBeenCalledTimes(1);
  fireEvent.click(details.querySelector("summary")!);
  await waitFor(() => expect(fetchBallots).toHaveBeenCalledTimes(2));
  view.unmount();
  client.clear();
});
