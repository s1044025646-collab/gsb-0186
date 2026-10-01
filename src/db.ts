import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Cell, PuzzleInput, SolveConfig, SolveResult } from "./types.ts";

export interface StoredPuzzle {
  id: number;
  uuid: string;
  name: string | null;
  rows: number;
  cols: number;
  row_clues: string;
  col_clues: string;
  created_at: string;
}

export interface StoredKnownVersion {
  id: number;
  puzzle_id: number;
  version: number;
  known: string;
  created_at: string;
}

export interface StoredResult {
  id: number;
  puzzle_id: number;
  known_version: number;
  config: string;
  result: string;
  outcome: string;
  created_at: string;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    const abs = resolve(dbPath);
    mkdirSync(dirname(abs), { recursive: true });
    this.db = new DatabaseSync(abs);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS puzzles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL UNIQUE,
        name TEXT,
        rows INTEGER NOT NULL,
        cols INTEGER NOT NULL,
        row_clues TEXT NOT NULL,
        col_clues TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS known_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        puzzle_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        known TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(puzzle_id, version),
        FOREIGN KEY(puzzle_id) REFERENCES puzzles(id)
      );
      CREATE TABLE IF NOT EXISTS solve_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        json TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        puzzle_id INTEGER NOT NULL,
        known_version INTEGER NOT NULL,
        config TEXT NOT NULL,
        result TEXT NOT NULL,
        outcome TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(puzzle_id) REFERENCES puzzles(id)
      );
    `);
  }

  insertPuzzle(uuid: string, p: PuzzleInput): StoredPuzzle {
    const stmt = this.db.prepare(
      `INSERT INTO puzzles (uuid, name, rows, cols, row_clues, col_clues)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const info = stmt.run(
      uuid,
      p.name ?? null,
      p.rows,
      p.cols,
      JSON.stringify(p.rowClues),
      JSON.stringify(p.colClues),
    );
    return this.getPuzzleById(Number(info.lastInsertRowid))!;
  }

  getPuzzleById(id: number): StoredPuzzle | null {
    return (this.db.prepare("SELECT * FROM puzzles WHERE id = ?").get(id) as StoredPuzzle | undefined) ?? null;
  }

  getPuzzleByUuid(uuid: string): StoredPuzzle | null {
    return (
      (this.db.prepare("SELECT * FROM puzzles WHERE uuid = ?").get(uuid) as StoredPuzzle | undefined) ??
      null
    );
  }

  listPuzzles(): StoredPuzzle[] {
    return this.db.prepare("SELECT * FROM puzzles ORDER BY id").all() as unknown as StoredPuzzle[];
  }

  /** 追加一个新的已知格版本；不改动任何旧版本/旧结果。 */
  addKnownVersion(
    puzzleId: number,
    known: { r: number; c: number; v: Cell }[],
  ): StoredKnownVersion {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM known_versions WHERE puzzle_id = ?")
      .get(puzzleId) as { v: number };
    const version = row.v + 1;
    this.db
      .prepare("INSERT INTO known_versions (puzzle_id, version, known) VALUES (?, ?, ?)")
      .run(puzzleId, version, JSON.stringify(known));
    return this.getKnownVersion(puzzleId, version)!;
  }

  getKnownVersion(puzzleId: number, version: number): StoredKnownVersion | null {
    return (
      (this.db
        .prepare("SELECT * FROM known_versions WHERE puzzle_id = ? AND version = ?")
        .get(puzzleId, version) as StoredKnownVersion | undefined) ?? null
    );
  }

  listKnownVersions(puzzleId: number): StoredKnownVersion[] {
    return this.db
      .prepare("SELECT * FROM known_versions WHERE puzzle_id = ? ORDER BY version")
      .all(puzzleId) as unknown as StoredKnownVersion[];
  }

  saveResult(
    puzzleId: number,
    knownVersion: number,
    config: SolveConfig,
    result: SolveResult,
  ): StoredResult {
    const configJson = JSON.stringify(config);
    const info = this.db
      .prepare(
        `INSERT INTO results (puzzle_id, known_version, config, result, outcome)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(puzzleId, knownVersion, configJson, JSON.stringify(result), result.outcome);
    return this.getResult(Number(info.lastInsertRowid))!;
  }

  getResult(id: number): StoredResult | null {
    return (this.db.prepare("SELECT * FROM results WHERE id = ?").get(id) as StoredResult | undefined) ?? null;
  }

  listResults(puzzleId: number): StoredResult[] {
    return this.db
      .prepare("SELECT * FROM results WHERE puzzle_id = ? ORDER BY id DESC")
      .all(puzzleId) as unknown as StoredResult[];
  }

  close(): void {
    this.db.close();
  }
}
