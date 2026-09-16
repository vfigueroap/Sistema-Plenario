import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SpeakingTurn } from "@workspace/api-client-react";

// The component reads its data through this hook; we drive it directly so each
// test renders a deterministic floor state without a network/query layer.
let mockTurns: SpeakingTurn[] = [];
vi.mock("@workspace/api-client-react", () => ({
  useListSpeakingTurns: () => ({ data: mockTurns }),
  getListSpeakingTurnsQueryKey: (id: number) => ["speakingTurns", id],
}));

const { CurrentSpeaker } = await import("./current-speaker");

function makeTurn(overrides: Partial<SpeakingTurn> = {}): SpeakingTurn {
  return {
    id: 1,
    sessionId: 10,
    agendaPointId: null,
    category: "pleno",
    kind: "individual",
    status: "hablando",
    position: 0,
    durationSeconds: 60,
    elapsedSeconds: 0,
    startedAt: null,
    faculty: null,
    userId: 50,
    label: "María González",
    participants: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  } as SpeakingTurn;
}

describe("CurrentSpeaker", () => {
  it("shows the empty state when nobody holds the floor", () => {
    mockTurns = [];
    render(<CurrentSpeaker sessionId={10} currentUserId={1} />);
    expect(screen.getByText("Nadie tiene la palabra")).toBeInTheDocument();
    expect(screen.queryByText("Tienes la palabra")).not.toBeInTheDocument();
  });

  it("shows another speaker holding the floor", () => {
    mockTurns = [makeTurn({ userId: 50, label: "María González" })];
    render(<CurrentSpeaker sessionId={10} currentUserId={1} />);
    expect(screen.getByText("En el uso de la palabra")).toBeInTheDocument();
    expect(screen.getByText("María González")).toBeInTheDocument();
    expect(screen.queryByText("Tienes la palabra")).not.toBeInTheDocument();
  });

  it("shows the 'Tienes la palabra' banner for the current user", () => {
    mockTurns = [makeTurn({ userId: 1, label: "Yo Mismo" })];
    render(<CurrentSpeaker sessionId={10} currentUserId={1} />);
    expect(screen.getByText("Tienes la palabra")).toBeInTheDocument();
    expect(screen.queryByText("En el uso de la palabra")).not.toBeInTheDocument();
  });

  it("recognizes the current user as part of a collective turn", () => {
    mockTurns = [
      makeTurn({
        userId: null,
        kind: "colectiva",
        faculty: "Ingeniería",
        label: "Palabra colectiva · Ingeniería",
        participants: [
          { userId: 1, displayName: "Yo Mismo", faculty: "Ingeniería" },
          { userId: 2, displayName: "Otro", faculty: "Ingeniería" },
        ],
      }),
    ];
    render(<CurrentSpeaker sessionId={10} currentUserId={1} />);
    expect(screen.getByText("Tienes la palabra")).toBeInTheDocument();
  });

  it("flags overtime when the running speaker exceeds the allotted time", () => {
    const startedAt = new Date(Date.now() - 120_000).toISOString();
    mockTurns = [
      makeTurn({ userId: 50, durationSeconds: 60, elapsedSeconds: 0, startedAt }),
    ];
    render(<CurrentSpeaker sessionId={10} currentUserId={1} />);
    expect(screen.getByText("Tiempo excedido")).toBeInTheDocument();
    // Clock should display a negative remaining value.
    expect(screen.getByText(/^-\d+:\d{2}$/)).toBeInTheDocument();
  });
});
