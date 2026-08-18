import type { Database } from "bun:sqlite";
import type { MemoryRepository } from "../../application/ports.ts";
import { MemoryNote } from "../../domain/memory/MemoryNote.ts";

export class SqliteMemoryRepository implements MemoryRepository {
  constructor(private readonly db: Database) {}

  async save(note: MemoryNote): Promise<MemoryNote> {
    const existing = this.byKey(note.key);
    const next = existing
      ? new MemoryNote({
          ...note,
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: new Date().toISOString(),
        })
      : note;
    this.db.run(
      `INSERT INTO memories (id, key, title, body, tags, source_run_id, source_agent_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         title = excluded.title,
         body = excluded.body,
         tags = excluded.tags,
         source_run_id = excluded.source_run_id,
         source_agent_id = excluded.source_agent_id,
         updated_at = excluded.updated_at`,
      [next.id, next.key, next.title, next.body, JSON.stringify(next.tags), next.sourceRunId, next.sourceAgentId, next.createdAt, next.updatedAt],
    );
    return next;
  }

  async get(idOrKey: string): Promise<MemoryNote | null> {
    const row = this.db.query<Row, [string, string]>(
      "SELECT * FROM memories WHERE id = ? OR key = ? LIMIT 1",
    ).get(idOrKey, idOrKey);
    return row ? fromRow(row) : null;
  }

  async search(query: string, limit = 12): Promise<MemoryNote[]> {
    const needle = `%${query.trim()}%`;
    if (!query.trim()) return this.recent(limit);
    const rows = this.db.query<Row, [string, string, string, string, number]>(
      `SELECT * FROM memories
       WHERE title LIKE ? OR body LIKE ? OR key LIKE ? OR tags LIKE ?
       ORDER BY updated_at DESC LIMIT ?`,
    ).all(needle, needle, needle, needle, limit);
    return rows.map(fromRow);
  }

  async recent(limit = 12): Promise<MemoryNote[]> {
    const rows = this.db.query<Row, [number]>(
      "SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?",
    ).all(limit);
    return rows.map(fromRow);
  }

  async remove(idOrKey: string): Promise<boolean> {
    const existing = await this.get(idOrKey);
    if (!existing) return false;
    this.db.run("DELETE FROM memories WHERE id = ? OR key = ?", [idOrKey, idOrKey]);
    return true;
  }

  private byKey(key: string): MemoryNote | null {
    const row = this.db.query<Row, [string]>("SELECT * FROM memories WHERE key = ?").get(key);
    return row ? fromRow(row) : null;
  }
}

type Row = {
  id: string;
  key: string;
  title: string;
  body: string;
  tags: string;
  source_run_id: string | null;
  source_agent_id: string | null;
  created_at: string;
  updated_at: string;
};

function fromRow(row: Row): MemoryNote {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags) as string[];
  } catch {
    tags = [];
  }
  return new MemoryNote({
    id: row.id,
    key: row.key,
    title: row.title,
    body: row.body,
    tags,
    sourceRunId: row.source_run_id ?? "",
    sourceAgentId: row.source_agent_id ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
