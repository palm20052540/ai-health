import { rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const projectRoot = resolve(process.cwd());
const outputDirectory = resolve(projectRoot, "dist");

if (dirname(outputDirectory) !== projectRoot || basename(outputDirectory) !== "dist") {
  throw new Error("Refusing to clean an unexpected build directory");
}

await rm(outputDirectory, { recursive: true, force: true });
