import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// 生成 M5 验证仓库：合并、二进制、非 UTF-8 文本、gitlink、超大与截断 diff。
const dir = process.argv[2] ?? "target/m5-fixture";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const git = (...args) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" }).toString().trim();
const write = (name, content) => {
  const target = join(dir, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
};
const commit = (message, addAll = true) => {
  if (addAll) {
    git("add", "-A");
  }
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
};

git("init", "-q", "-b", "main");
git("config", "user.name", "M5 Fixture");
git("config", "user.email", "m5@example.com");

write(
  "src/app.ts",
  [
    "export interface Point {",
    "  x: number;",
    "  y: number;",
    "}",
    "",
    "export function distance(a: Point, b: Point): number {",
    "  const dx = a.x - b.x;",
    "  const dy = a.y - b.y;",
    "  return Math.sqrt(dx * dx + dy * dy);",
    "}",
    "",
  ].join("\n"),
);
write("README.md", "# M5 fixture\n\n用于验证 commit 详情与单文件 diff 降级。\n");
write("utf16.txt", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("初始 UTF-16 内容\n", "utf16le")]));
write("latin1.txt", Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
write("bin.dat", Buffer.from([0x00, 0x01, 0x02, 0x00, 0x03, 0x04]));
write("folder/file.txt", "first\nsecond\nthird\n");
const c1 = commit("初始化 fixture");

git("checkout", "-q", "-b", "feature");
write("feature.ts", "export const featureFlag = true;\n");
const f1 = commit("feature: 增加开关");

git("checkout", "-q", "main");
write(
  "src/app.ts",
  [
    "export interface Point {",
    "  x: number;",
    "  y: number;",
    "}",
    "",
    "export function distance(a: Point, b: Point): number {",
    "  const dx = a.x + b.x;",
    "  const dy = a.y + b.y;",
    "  return Math.sqrt(dx * dx + dy * dy);",
    "}",
    "",
  ].join("\n"),
);
write("utf16.txt", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("修改后的 UTF-16 内容\n", "utf16le")]));
write("latin1.txt", Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0xff, 0x0a]));
write("bin.dat", Buffer.from([0x00, 0x09, 0x08, 0x00, 0x07, 0x06]));
write("large.txt", Array.from({ length: 6000 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n") + "\n");
write("big.txt", ("big content " + "y".repeat(80) + "\n").repeat(22000));
git("add", "src/app.ts", "utf16.txt", "latin1.txt", "bin.dat", "large.txt", "big.txt");
git("update-index", "--add", "--cacheinfo", `160000,${c1},vendor`);
const c2 = commit("修改源码、二进制、编码文件并登记子模块", false);

write("large.txt", Array.from({ length: 6000 }, (_, i) => `line ${i} changed ${"z".repeat(40)}`).join("\n") + "\n");
write("big.txt", ("big content " + "w".repeat(80) + "\n").repeat(30000));
git("add", "large.txt", "big.txt");
git("update-index", "--add", "--cacheinfo", `160000,${f1},vendor`);
const c3 = commit("更新大文件与子模块指针", false);

git("merge", "-q", "--no-ff", "feature", "-m", "merge feature into main");
const merge = git("rev-parse", "HEAD");
if (!git("ls-tree", "--name-only", "HEAD", "vendor")) {
  throw new Error("gitlink vendor 未进入提交树");
}

console.log(JSON.stringify({ dir, c1, f1, c2, c3, merge }, null, 2));
