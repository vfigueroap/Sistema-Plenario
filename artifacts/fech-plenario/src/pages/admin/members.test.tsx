import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/layout", () => ({ AppLayout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    useListMembers: () => ({ data: [{ id: 1, username: "test-member", displayName: "Test Member", password: "legacy-secret", rol: "miembro", active: true, votingWeight: 1, votingWeightAlt: 0 }], refetch: vi.fn() }),
    useListUnidadesAcademicas: () => ({ data: [] }),
    useGetMemberAttendance: () => ({ data: [] }),
  };
});
const { default: AdminMembers } = await import("./members");

function renderMembers() {
  return render(<QueryClientProvider client={new QueryClient()}><AdminMembers /></QueryClientProvider>);
}

describe("member credential privacy", () => {
  it("has no stored-password column, even if legacy data contains a password", () => {
    renderMembers();
    expect(screen.queryByRole("columnheader", { name: "Contraseña" })).not.toBeInTheDocument();
    expect(screen.queryByText("legacy-secret")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Contraseña" })).toBeInTheDocument();
  });

  it("creates accounts with an empty, concealed password input", () => {
    renderMembers();
    fireEvent.click(screen.getByRole("button", { name: "Agregar miembre" }));
    const password = screen.getByLabelText("Contraseña", { exact: true });
    expect(password).toHaveValue("");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "new-password");
  });

  it("retains reset with an accessible concealed input", () => {
    renderMembers();
    fireEvent.click(screen.getByRole("button", { name: "Contraseña" }));
    expect(screen.getByLabelText("Nueva contraseña")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Restablecer" })).toBeInTheDocument();
  });
});
