import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let _setupDone = false;

export function ensureAdkCredentials(): void {
  if (_setupDone) return;
  _setupDone = true;

  const saJson = process.env.VERTEX_AI_SERVICE_ACCOUNT_JSON;
  if (!saJson) return;

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return;

  try {
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `adk-sa-${process.pid}.json`);
    fs.writeFileSync(tmpFile, saJson, { mode: 0o600 });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpFile;
  } catch {
    // Non-fatal — ADK will fall back to ADC
  }
}
