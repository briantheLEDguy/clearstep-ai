import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));

export function runNextBuild(environmentOverrides) {
  const result = spawnSync(process.execPath, [nextCli, "build"], {
    env: { ...process.env, ...environmentOverrides },
    stdio: "inherit",
  });

  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
