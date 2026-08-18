import type { Database } from "bun:sqlite";
import type { EpisodeRepository } from "../../application/ports.ts";
import { Episode } from "../../domain/memory/Episode.ts";

export class SqliteEpisodeRepository implements EpisodeRepository {
  constructor(private readonly db: Database) {}

  async save(episode: Episode): Promise<void> {
    this.db.run(
      `INSERT INTO episodes (id, agent_id, task_class, failure_mode, snapshot) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot`,
      [episode.id, episode.agentId, episode.taskClass, episode.failureMode, JSON.stringify(episode)],
    );
  }

  async findForAgent(agentId: string, taskClass?: string): Promise<Episode[]> {
    const rows = taskClass
      ? this.db.query<{ snapshot: string }, [string, string]>(
          "SELECT snapshot FROM episodes WHERE agent_id = ? AND task_class = ? ORDER BY id DESC LIMIT 20",
        ).all(agentId, taskClass)
      : this.db.query<{ snapshot: string }, [string]>(
          "SELECT snapshot FROM episodes WHERE agent_id = ? ORDER BY id DESC LIMIT 20",
        ).all(agentId);
    return rows.map((r) => new Episode(JSON.parse(r.snapshot)));
  }

  async findFailures(taskClass: string, failureMode: string): Promise<Episode[]> {
    const rows = this.db.query<{ snapshot: string }, [string, string]>(
      "SELECT snapshot FROM episodes WHERE task_class = ? AND failure_mode = ? LIMIT 10",
    ).all(taskClass, failureMode);
    return rows.map((r) => new Episode(JSON.parse(r.snapshot)));
  }

  async findRecent(limit = 12): Promise<Episode[]> {
    const rows = this.db.query<{ snapshot: string }, [number]>(
      "SELECT snapshot FROM episodes ORDER BY id DESC LIMIT ?",
    ).all(limit);
    return rows.map((r) => new Episode(JSON.parse(r.snapshot)));
  }

  async search(query: string, limit = 10): Promise<Episode[]> {
    const needle = `%${query.trim()}%`;
    if (!query.trim()) return this.findRecent(limit);
    const rows = this.db.query<{ snapshot: string }, [string, number]>(
      "SELECT snapshot FROM episodes WHERE snapshot LIKE ? ORDER BY id DESC LIMIT ?",
    ).all(needle, limit);
    return rows.map((r) => new Episode(JSON.parse(r.snapshot)));
  }
}
