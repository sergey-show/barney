import type { Database } from "bun:sqlite";
import type { RunRepository } from "../../application/ports.ts";
import { Agent } from "../../domain/agent/Agent.ts";
import { Run } from "../../domain/run/Run.ts";
import { SqliteAgentRepository } from "./SqliteAgentRepository.ts";

export class SqliteRunRepository implements RunRepository {
  constructor(
    private readonly db: Database,
    private readonly agents: SqliteAgentRepository,
  ) {}

  async save(run: Run): Promise<void> {
    const snap = JSON.stringify(run.snapshot());
    this.db.run(
      `INSERT INTO runs (id, agent_id, snapshot) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot`,
      [run.id.value, run.agentId, snap],
    );
  }

  async get(id: string): Promise<Run | null> {
    const row = this.db.query<{ snapshot: string; agent_id: string }, [string]>(
      "SELECT snapshot, agent_id FROM runs WHERE id = ?",
    ).get(id);
    if (!row) return null;
    const agent = (await this.agents.get(row.agent_id)) ?? Agent.create({ name: "rehydrated" });
    return Run.rehydrate(JSON.parse(row.snapshot), agent);
  }

  async list(): Promise<Run[]> {
    const rows = this.db.query<{ snapshot: string; agent_id: string }, []>("SELECT snapshot, agent_id FROM runs").all();
    const result: Run[] = [];
    for (const row of rows) {
      const agent = (await this.agents.get(row.agent_id)) ?? Agent.create({ name: "rehydrated" });
      result.push(Run.rehydrate(JSON.parse(row.snapshot), agent));
    }
    return result;
  }
}
