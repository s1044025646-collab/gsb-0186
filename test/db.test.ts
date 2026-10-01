import assert from "node:assert/strict";
import { test } from "node:test";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "../src/db.ts";
import { SAMPLES } from "../src/samples.ts";
import { NonogramService } from "../src/service.ts";

let counter = 0;

function freshService(): { store: Store; service: NonogramService; dbPath: string } {
  const dbPath = resolve("data", `test-${process.pid}-${counter++}.db`);
  rmSync(dbPath, { force: true });
  const store = new Store(dbPath);
  return { store, service: new NonogramService(store), dbPath };
}

test("导入->求解->关闭->重开读取结果快照", () => {
  const { store, service, dbPath } = freshService();
  const imported = service.importPuzzle(SAMPLES.symmetric);
  const pid = imported.puzzle.id;
  const solved = service.solve(pid);
  assert.equal(solved.result.outcome, "unique");
  const resultId = solved.stored.id;
  store.close();

  const store2 = new Store(dbPath);
  const service2 = new NonogramService(store2);
  const reloaded = service2.getResult(resultId);
  assert.equal(reloaded.outcome, "unique");
  const parsed = JSON.parse(reloaded.result);
  assert.equal(parsed.witnesses.length, 1);
  store2.close();
});

test("修改已知格产生新版本，旧解不被污染", () => {
  const { store, service } = freshService();
  const imported = service.importPuzzle(SAMPLES.partial);
  const pid = imported.puzzle.id;
  service.solve(pid); // v1
  service.updateKnown(pid, [
    ...(SAMPLES.partial.known ?? []),
    { r: 4, c: 4, v: 1 },
  ]);
  service.solve(pid, { knownVersion: 2 });

  const versions = store.listKnownVersions(pid);
  assert.equal(versions.length, 2);
  const v1 = store.listResults(pid).filter((r) => r.known_version === 1);
  assert.equal(v1.length, 1);
  store.close();
});

test("反算线索与题面一致", () => {
  const { store, service } = freshService();
  const imported = service.importPuzzle(SAMPLES.symmetric);
  const solved = service.solve(imported.puzzle.id);
  const ascii = service.renderWitness(solved.result, 0);
  const rev = service.reverseClues(ascii);
  const check = service.check(imported.puzzle.id);
  assert.deepEqual(rev.rowClues, check.puzzle.rowClues);
  assert.deepEqual(rev.colClues, check.puzzle.colClues);
  store.close();
});
