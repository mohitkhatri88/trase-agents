import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { Agent } from "@trase/core";
import { AgentList } from "./AgentList.js";

const agents: Agent[] = [
  { id: 1, name: "Invoice Parser", description: "Extracts totals from invoices", createdAt: "" },
  { id: 2, name: "Contract Summariser", description: "Summarises legal agreements", createdAt: "" },
  { id: 3, name: "Health Checker", description: "Pings monitored services", createdAt: "" },
];

const renderList = (list: Agent[] = agents, selectedId: number | null = null) =>
  render(
    <MemoryRouter>
      <AgentList agents={list} selectedId={selectedId} />
    </MemoryRouter>,
  );

const filterBox = () => screen.getByRole("searchbox", { name: /filter agents/i });

describe("AgentList filtering", () => {
  it("shows every agent before any filtering", () => {
    renderList();
    expect(screen.getAllByTestId("agent-card")).toHaveLength(3);
  });

  it("narrows by name as the user types", async () => {
    const user = userEvent.setup();
    renderList();

    await user.type(filterBox(), "invoice");

    expect(screen.getByText("Invoice Parser")).toBeInTheDocument();
    expect(screen.queryByText("Contract Summariser")).not.toBeInTheDocument();
    expect(screen.queryByText("Health Checker")).not.toBeInTheDocument();
  });

  it("matches on description, not only name", async () => {
    const user = userEvent.setup();
    renderList();

    await user.type(filterBox(), "legal");

    expect(screen.getByText("Contract Summariser")).toBeInTheDocument();
    expect(screen.queryByText("Invoice Parser")).not.toBeInTheDocument();
  });

  it("is case insensitive", async () => {
    const user = userEvent.setup();
    renderList();

    await user.type(filterBox(), "HEALTH");

    expect(screen.getByText("Health Checker")).toBeInTheDocument();
    expect(screen.getAllByTestId("agent-card")).toHaveLength(1);
  });

  it("ignores surrounding whitespace", async () => {
    const user = userEvent.setup();
    renderList();

    await user.type(filterBox(), "   invoice   ");

    expect(screen.getAllByTestId("agent-card")).toHaveLength(1);
  });

  it("narrows progressively, character by character", async () => {
    const user = userEvent.setup();
    renderList();

    await user.type(filterBox(), "c");
    // "Contract Summariser", "Health Checker" (Checker), "Invoice Parser" (Invoice)
    expect(screen.getAllByTestId("agent-card")).toHaveLength(3);

    await user.type(filterBox(), "on");
    expect(screen.getAllByTestId("agent-card")).toHaveLength(1);
    expect(screen.getByText("Contract Summariser")).toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    renderList();

    await user.type(filterBox(), "zzzzz");

    expect(screen.queryByTestId("agent-card")).not.toBeInTheDocument();
    expect(screen.getByText(/no agents match that filter/i)).toBeInTheDocument();
  });

  it("restores the full list when the filter is cleared", async () => {
    const user = userEvent.setup();
    renderList();

    await user.type(filterBox(), "invoice");
    expect(screen.getAllByTestId("agent-card")).toHaveLength(1);

    await user.clear(filterBox());
    expect(screen.getAllByTestId("agent-card")).toHaveLength(3);
  });

  it("distinguishes an empty dataset from an empty result", () => {
    renderList([]);
    expect(screen.getByText(/no agents yet/i)).toBeInTheDocument();
  });

  it("marks the selected agent for assistive technology", () => {
    renderList(agents, 2);
    const selected = screen.getByText("Contract Summariser").closest("a");
    expect(selected).toHaveAttribute("aria-current", "true");
  });
});
