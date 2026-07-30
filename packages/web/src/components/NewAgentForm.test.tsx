import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NewAgentForm } from "./NewAgentForm.js";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

let posted: Array<{ url: string; body: unknown }> = [];

function stubFetch(ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      posted.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      if (!ok) {
        return new Response(
          JSON.stringify({ error: { code: "INVALID_FIELD", message: "name is required" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ id: 9, name: "New", description: "d", createdAt: "" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

beforeEach(() => {
  posted = [];
  stubFetch();
});
afterEach(() => vi.unstubAllGlobals());

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByTestId("new-agent-toggle"));
  return screen.getByTestId("new-agent-form");
};

describe("NewAgentForm", () => {
  it("stays collapsed until asked for, so the agent list stays primary", () => {
    render(<NewAgentForm />, { wrapper });

    expect(screen.getByTestId("new-agent-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("new-agent-form")).not.toBeInTheDocument();
  });

  it("keeps submit disabled until name and description are both filled", async () => {
    const user = userEvent.setup();
    render(<NewAgentForm />, { wrapper });
    await open(user);

    const submit = screen.getByRole("button", { name: /create agent/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/agent name/i), "Report Builder");
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/agent description/i), "Builds reports");
    expect(submit).toBeEnabled();
  });

  it("defaults to the reliable behaviour", async () => {
    const user = userEvent.setup();
    render(<NewAgentForm />, { wrapper });
    await open(user);

    expect(screen.getByRole("radio", { name: /reliable/i })).toBeChecked();
  });

  it("posts the chosen behaviour along with the name and description", async () => {
    const user = userEvent.setup();
    render(<NewAgentForm />, { wrapper });
    await open(user);

    await user.type(screen.getByLabelText(/agent name/i), "Scraper");
    await user.type(screen.getByLabelText(/agent description/i), "Scrapes things");
    await user.click(screen.getByRole("radio", { name: /flaky/i }));
    await user.click(screen.getByRole("button", { name: /create agent/i }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.url).toContain("/api/agents");
    expect(posted[0]!.body).toEqual({
      name: "Scraper",
      description: "Scrapes things",
      behaviour: "flaky",
    });
  });

  it("closes and clears itself after a successful create", async () => {
    const user = userEvent.setup();
    render(<NewAgentForm />, { wrapper });
    await open(user);

    await user.type(screen.getByLabelText(/agent name/i), "Scraper");
    await user.type(screen.getByLabelText(/agent description/i), "Scrapes things");
    await user.click(screen.getByRole("button", { name: /create agent/i }));

    await waitFor(() => expect(screen.queryByTestId("new-agent-form")).not.toBeInTheDocument());
    // Reopening starts blank rather than showing the last submission.
    await open(user);
    expect(screen.getByLabelText(/agent name/i)).toHaveValue("");
  });

  it("keeps the form open and shows the error when the server rejects it", async () => {
    stubFetch(false);
    const user = userEvent.setup();
    render(<NewAgentForm />, { wrapper });
    await open(user);

    await user.type(screen.getByLabelText(/agent name/i), "Scraper");
    await user.type(screen.getByLabelText(/agent description/i), "Scrapes things");
    await user.click(screen.getByRole("button", { name: /create agent/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("name is required");
    // Nothing to retype — the form is still there with the input intact.
    expect(screen.getByLabelText(/agent name/i)).toHaveValue("Scraper");
  });

  it("can be dismissed without creating anything", async () => {
    const user = userEvent.setup();
    render(<NewAgentForm />, { wrapper });
    await open(user);

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByTestId("new-agent-form")).not.toBeInTheDocument();
    expect(posted).toHaveLength(0);
  });
});
