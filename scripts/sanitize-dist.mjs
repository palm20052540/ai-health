import { rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const projectRoot = resolve(process.cwd());
const previewSecrets = resolve(projectRoot, "dist", "tong_fit", ".dev.vars");

if (basename(previewSecrets) !== ".dev.vars" || basename(dirname(previewSecrets)) !== "tong_fit") {
  throw new Error("Refusing to sanitize an unexpected build path");
}

await rm(previewSecrets, { force: true });
