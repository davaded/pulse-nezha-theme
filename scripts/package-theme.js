import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await readFile(path.join(root, "dist/index.html"));
const artifacts = path.join(root, "artifacts");
await mkdir(artifacts, { recursive: true });
const temporary = path.join(artifacts, `pulse-${process.pid}.zip`);
const result = spawnSync("zip", ["-qr", temporary, "dist"], {
	cwd: root,
	stdio: "inherit",
});
if (result.error)
	throw new Error("Packaging requires the zip command (macOS/Linux).", {
		cause: result.error,
	});
if (result.status !== 0) throw new Error(`zip exited with ${result.status}`);
const archive = path.join(artifacts, "dist.zip");
await rename(temporary, archive);
const checksum = createHash("sha256")
	.update(await readFile(archive))
	.digest("hex");
const { writeFile } = await import("node:fs/promises");
await writeFile(
	path.join(artifacts, "dist.zip.sha256"),
	`${checksum}  dist.zip\n`,
);
console.log(`Theme archive: ${archive}\nSHA-256: ${checksum}`);
