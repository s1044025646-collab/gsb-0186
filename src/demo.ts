import { resolve } from "node:path";
import { rmSync } from "node:fs";
import { Store } from "./db.ts";
import { renderGrid } from "./grid.ts";
import { SAMPLES } from "./samples.ts";
import { NonogramService } from "./service.ts";
import { solve } from "./solver.ts";
import { validatePuzzle } from "./validate.ts";

function hr(title: string): void {
  console.log("\n================ " + title + " ================");
}

function main(): void {
  const dbPath = resolve("data", "demo.db");
  rmSync(dbPath, { force: true });
  rmSync(dbPath + "-wal", { force: true });
  rmSync(dbPath + "-shm", { force: true });
  const store = new Store(dbPath);
  const service = new NonogramService(store);

  // 1) 部分完成题面：先获取“纯逻辑”提示
  hr("1. 部分完成题面：获取下一步逻辑提示");
  const imported = service.importPuzzle(SAMPLES.partial);
  const pid = imported.puzzle.id;
  console.log(`已导入 ${SAMPLES.partial.name}，puzzleId=${pid}，knownVersion=${imported.knownVersion}`);
  const hint = service.hint(pid);
  console.log(`纯逻辑可推出 ${hint.steps.length} 步（全部 logical=true，无猜测）：`);
  for (const s of hint.steps.slice(0, 6)) {
    const label = s.orientation === "row" ? `行${s.index + 1}` : `列${s.index + 1}`;
    const cells = s.cells.map((c) => `(${c.r + 1},${c.c + 1})=${c.v === 1 ? "黑" : "白"}`).join(" ");
    console.log(`  ${s.seq + 1}. ${label} -> ${cells}`);
    console.log(`     ${s.reason}`);
  }

  // 2) 完整求解（唯一性必须穷尽搜索）
  hr("2. 求解并证明唯一性");
  const solved = service.solve(pid);
  console.log("结论:", solved.result.outcome, "节点数:", solved.result.nodesVisited);
  console.log(renderGrid(solved.result.witnesses[0]!));

  // 3) 从解反算线索，并与原题线索核对
  hr("3. 从解反算线索并核对");
  const witnessRows = service.renderWitness(solved.result, 0);
  const reversed = service.reverseClues(witnessRows);
  const check = service.check(pid);
  const ok =
    JSON.stringify(reversed.rowClues) === JSON.stringify(check.puzzle.rowClues) &&
    JSON.stringify(reversed.colClues) === JSON.stringify(check.puzzle.colClues);
  console.log("反算行线索:", JSON.stringify(reversed.rowClues));
  console.log("反算列线索:", JSON.stringify(reversed.colClues));
  console.log("与原题线索一致:", ok);
  console.log("解严格满足线索:", service.verify(solved.result.witnesses[0]!, check.puzzle));

  // 4) 多解题：两份不同见证
  hr("4. 多解题：两份不同见证");
  const multi = solve(validatePuzzle(SAMPLES.multiple));
  console.log("结论:", multi.outcome, "见证数:", multi.witnesses.length);
  multi.witnesses.forEach((w, i) => {
    console.log(`见证 ${i + 1}:`);
    console.log(renderGrid(w));
  });

  // 5) 明确矛盾：无解
  hr("5. 明确矛盾题：无解");
  const unsat = solve(validatePuzzle(SAMPLES.contradiction));
  console.log("结论:", unsat.outcome, "（节点数:", unsat.nodesVisited + "）");

  // 6) 预算耗尽：极小节点预算，证明不会被误判为无解
  hr("6. 预算极小：预算耗尽（非无解）");
  // 用一张较大的弱约束棋盘（每格自由度高），配合极小预算触发预算耗尽
  const loose = validatePuzzle({
    name: "loose-8x8",
    rows: 8,
    cols: 8,
    rowClues: Array(8).fill([1]),
    colClues: Array(8).fill([1]),
  });
  const exhausted = solve(loose, { maxNodes: 5, maxTimeMs: 60_000 });
  console.log("结论:", exhausted.outcome);
  console.log("边界:", exhausted.boundary);

  // 7) 重启后读取历史结果快照
  hr("7. 模拟重启：重新打开数据库读取历史结果");
  store.close();
  const store2 = new Store(dbPath);
  const service2 = new NonogramService(store2);
  const history = service2.listResults(pid);
  console.log(`谜题 ${pid} 历史结果数: ${history.length}`);
  for (const r of history) {
    const detail = service2.getResult(r.id);
    const parsed = JSON.parse(detail.result);
    console.log(`  result#${r.id} v${r.known_version} outcome=${r.outcome} 节点=${parsed.nodesVisited}`);
  }

  // 8) 已知格版本隔离：新增版本不污染旧解
  hr("8. 已知格新版本不污染旧解");
  const before = service2.listResults(pid).length;
  service2.updateKnown(pid, [
    ...(SAMPLES.partial.known ?? []),
    { r: 4, c: 0, v: 1 },
  ]);
  service2.solve(pid, { knownVersion: 2 });
  const v1Results = service2.listResults(pid).filter((r) => r.known_version === 1);
  console.log(`版本1结果仍有 ${v1Results.length} 条（求解前为 ${before} 条），未被覆盖`);
  store2.close();
}

main();
