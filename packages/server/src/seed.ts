import type { SimulationProfile } from "@trase/core";
import type { Store } from "./store/index.js";

interface SeedAgent {
  name: string;
  description: string;
  simulationProfile: SimulationProfile;
}

/**
 * Six agents with deliberately different personalities — fast and reliable,
 * slow enough to cancel, and one that fails roughly a third of the time — so
 * every code path (success, failure, cancellation) is reachable by clicking
 * rather than by waiting for luck.
 */
export const SEED_AGENTS: SeedAgent[] = [
  {
    name: "Invoice Parser",
    description: "Extracts totals, line items and tax from supplier invoices.",
    simulationProfile: {
      steps: [
        { label: "Fetching document", minMs: 600, maxMs: 1200, failureRate: 0.02 },
        { label: "Extracting fields", minMs: 1200, maxMs: 2400, failureRate: 0.1 },
        { label: "Validating totals", minMs: 400, maxMs: 900, failureRate: 0.05 },
        { label: "Writing results", minMs: 300, maxMs: 600, failureRate: 0.01 },
      ],
    },
  },
  {
    name: "Contract Summariser",
    description: "Produces a clause-by-clause summary of a legal agreement.",
    simulationProfile: {
      steps: [
        { label: "Loading contract", minMs: 500, maxMs: 900, failureRate: 0.01 },
        { label: "Segmenting clauses", minMs: 900, maxMs: 1800, failureRate: 0.04 },
        { label: "Summarising", minMs: 1500, maxMs: 2800, failureRate: 0.06 },
      ],
    },
  },
  {
    name: "Inbox Triager",
    description: "Sorts incoming mail into priority buckets and drafts replies.",
    simulationProfile: {
      steps: [
        { label: "Reading inbox", minMs: 300, maxMs: 600, failureRate: 0.01 },
        { label: "Classifying messages", minMs: 500, maxMs: 1000, failureRate: 0.03 },
        { label: "Drafting replies", minMs: 800, maxMs: 1600, failureRate: 0.05 },
      ],
    },
  },
  {
    name: "Flaky Web Scraper",
    description: "Collects pricing from partner sites. Frequently rate-limited.",
    simulationProfile: {
      steps: [
        { label: "Resolving targets", minMs: 300, maxMs: 700, failureRate: 0.05 },
        { label: "Fetching pages", minMs: 900, maxMs: 1800, failureRate: 0.35 },
        { label: "Parsing prices", minMs: 500, maxMs: 1100, failureRate: 0.1 },
      ],
    },
  },
  {
    name: "Nightly Reconciler",
    description: "Reconciles ledger entries against the payment provider. Slow.",
    simulationProfile: {
      steps: [
        { label: "Loading ledger", minMs: 1500, maxMs: 2500, failureRate: 0.01 },
        { label: "Fetching settlements", minMs: 2000, maxMs: 3200, failureRate: 0.03 },
        { label: "Matching entries", minMs: 2200, maxMs: 3500, failureRate: 0.05 },
        { label: "Writing report", minMs: 800, maxMs: 1400, failureRate: 0.01 },
      ],
    },
  },
  {
    name: "Health Checker",
    description: "Pings monitored services and records latency. Fast and reliable.",
    simulationProfile: {
      steps: [
        { label: "Pinging services", minMs: 200, maxMs: 400, failureRate: 0.01 },
        { label: "Recording latency", minMs: 200, maxMs: 400, failureRate: 0.01 },
      ],
    },
  },
];

const SEED_TASKS = [
  {
    agent: "Invoice Parser",
    title: "Process March supplier invoices",
    description: "42 PDFs waiting in the shared drive.",
  },
  {
    agent: "Invoice Parser",
    title: "Re-check flagged invoices",
    description: "Seven invoices failed validation last week.",
  },
  {
    agent: "Contract Summariser",
    title: "Summarise the Acme MSA",
    description: "Focus on termination and liability clauses.",
  },
  {
    agent: "Inbox Triager",
    title: "Triage the support inbox",
    description: "Overnight backlog, roughly 200 messages.",
  },
  {
    agent: "Flaky Web Scraper",
    title: "Collect competitor pricing",
    description: "Twelve partner sites, hourly refresh.",
  },
  {
    agent: "Nightly Reconciler",
    title: "Reconcile yesterday's ledger",
    description: "Full pass against the payment provider.",
  },
  {
    agent: "Health Checker",
    title: "Check production endpoints",
    description: "All public services, every five minutes.",
  },
];

/**
 * Extra agents whose outcome is decided by the profile rather than by chance —
 * failureRate 0 can never fail, failureRate 1 always fails. That makes the
 * end-to-end suite deterministic without mocking anything or depending on a
 * particular RNG seed.
 *
 * Seeded only when TRASE_E2E=1, so the demo data stays realistic.
 */
export const E2E_AGENTS: SeedAgent[] = [
  {
    name: "Always Succeeds",
    description: "Deterministic fixture agent used by the end-to-end suite.",
    simulationProfile: {
      steps: [
        { label: "Doing the first thing", minMs: 200, maxMs: 200, failureRate: 0 },
        { label: "Doing the second thing", minMs: 200, maxMs: 200, failureRate: 0 },
      ],
    },
  },
  {
    name: "Always Fails",
    description: "Deterministic fixture agent used by the end-to-end suite.",
    simulationProfile: {
      steps: [
        { label: "Doing the first thing", minMs: 200, maxMs: 200, failureRate: 0 },
        { label: "Reticulating splines", minMs: 200, maxMs: 200, failureRate: 1 },
      ],
    },
  },
  {
    name: "Slow And Steady",
    description: "Deterministic fixture agent, slow enough to cancel mid-run.",
    simulationProfile: {
      steps: Array.from({ length: 6 }, (_, i) => ({
        label: `Long step ${i + 1}`,
        minMs: 1500,
        maxMs: 1500,
        failureRate: 0,
      })),
    },
  },
];

const E2E_TASKS = [
  { agent: "Always Succeeds", title: "E2E success task", description: "Completes every time." },
  { agent: "Always Fails", title: "E2E failure task", description: "Fails every time." },
  { agent: "Slow And Steady", title: "E2E cancellable task", description: "Long enough to cancel." },
];

/** Returns true if it inserted anything. Safe to call on every boot. */
export async function seedIfEmpty(store: Store): Promise<boolean> {
  if ((await store.agents.count()) > 0) return false;

  const includeFixtures = process.env.TRASE_E2E === "1";
  const agents = includeFixtures ? [...SEED_AGENTS, ...E2E_AGENTS] : SEED_AGENTS;
  const tasks = includeFixtures ? [...SEED_TASKS, ...E2E_TASKS] : SEED_TASKS;

  const byName = new Map<string, number>();
  for (const agent of agents) {
    const created = await store.agents.create(agent);
    byName.set(created.name, created.id);
  }

  for (const task of tasks) {
    const agentId = byName.get(task.agent);
    if (agentId === undefined) continue;
    await store.tasks.create({
      title: task.title,
      description: task.description,
      agentId,
    });
  }

  return true;
}
