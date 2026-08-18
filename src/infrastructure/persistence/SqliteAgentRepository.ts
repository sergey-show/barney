import type { Database } from "bun:sqlite";
import { Agent } from "../../domain/agent/Agent.ts";
import type { AgentRepository } from "../../application/ports.ts";

export class SqliteAgentRepository implements AgentRepository {
  constructor(private readonly db: Database) {}

  async save(agent: Agent): Promise<void> {
    const snap = JSON.stringify(agent.snapshot());
    this.db.run(
      `INSERT INTO agents (id, name, snapshot) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, snapshot = excluded.snapshot`,
      [agent.id.value, agent.name, snap],
    );
  }

  async get(id: string): Promise<Agent | null> {
    const row = this.db.query<{ snapshot: string }, [string]>("SELECT snapshot FROM agents WHERE id = ?").get(id);
    return row ? Agent.rehydrate(JSON.parse(row.snapshot)) : null;
  }

  async findByName(name: string): Promise<Agent | null> {
    const row = this.db.query<{ snapshot: string }, [string]>("SELECT snapshot FROM agents WHERE lower(name) = lower(?)").get(name);
    return row ? Agent.rehydrate(JSON.parse(row.snapshot)) : null;
  }

  async findSimilar(taskClass: string, skillNames: string[]): Promise<Agent | null> {
    const all = await this.list();
    return (
      all.find((a) => a.taskClass === taskClass && skillNames.some((n) => a.skillsLock.list().some((s) => s.name === n))) ??
      all.find((a) => a.taskClass === taskClass) ??
      null
    );
  }

  async list(): Promise<Agent[]> {
    const rows = this.db.query<{ snapshot: string }, []>("SELECT snapshot FROM agents").all();
    return rows.map((r) => Agent.rehydrate(JSON.parse(r.snapshot)));
  }
}
