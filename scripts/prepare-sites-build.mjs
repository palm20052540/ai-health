import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(process.cwd());
const builtWorker = resolve(projectRoot, "dist", "tong_fit", "index.js");
const sitesWorkerDirectory = resolve(projectRoot, "dist", "server");
const sitesWorker = resolve(sitesWorkerDirectory, "index.js");
const hostingSource = resolve(projectRoot, ".openai", "hosting.json");
const hostingDirectory = resolve(projectRoot, "dist", ".openai");
const hostingTarget = resolve(hostingDirectory, "hosting.json");

await mkdir(sitesWorkerDirectory, { recursive: true });
await mkdir(hostingDirectory, { recursive: true });
await copyFile(builtWorker, sitesWorker);
await copyFile(hostingSource, hostingTarget);

console.log("Prepared Sites build: dist/server/index.js and dist/.openai/hosting.json");
