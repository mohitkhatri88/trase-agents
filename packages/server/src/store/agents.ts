import { eq, asc, sql } from "drizzle-orm";
import type { Agent, SimulationProfile } from "@trase/core";
import type { Db } from "../db/client.js";
import { agents } from "../db/schema.js";

export interface AgentStore {
  list(): Promise<Agent[]>;
  get(id: number): Promise<Agent | undefined>;
  getProfile(id: number): Promise<SimulationProfile | undefined>;
  create(input: {
    name: string;
    description: string;
    simulationProfile: SimulationProfile;
  }): Promise<Agent>;
  count(): Promise<number>;
}

const toAgent = (row: typeof agents.$inferSelect): Agent => ({
  id: row.id,
  name: row.name,
  description: row.description,
  createdAt: row.createdAt,
});

export function createAgentStore(db: Db): AgentStore {
  return {
    async list() {
      const rows = await db.select().from(agents).orderBy(asc(agents.name));
      return rows.map(toAgent);
    },

    async get(id) {
      const [row] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
      return row ? toAgent(row) : undefined;
    },

    async getProfile(id) {
      const [row] = await db
        .select({ profile: agents.simulationProfile })
        .from(agents)
        .where(eq(agents.id, id))
        .limit(1);
      return row?.profile;
    },

    async create(input) {
      const [row] = await db
        .insert(agents)
        .values({ ...input, createdAt: new Date().toISOString() })
        .returning();
      if (!row) throw new Error("failed to insert agent");
      return toAgent(row);
    },

    async count() {
      const [row] = await db.select({ n: sql<number>`count(*)` }).from(agents);
      return Number(row?.n ?? 0);
    },
  };
}
