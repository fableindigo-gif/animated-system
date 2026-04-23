// All lines below should produce ZERO violations.
// This file calls assertWorkspaceOwnedByOrg — so all body/query reads are OK.
// Additional safe patterns are also present.
import { Router } from "express";
import { assertWorkspaceOwnedByOrg } from "../../middleware/tenant-isolation";
const router = Router();

// 1. File calls ownership helper — any body read in this file is covered.
router.post("/with-helper", async (req, res) => {
  const wsId = req.body.workspaceId;
  const orgId = 1;
  await assertWorkspaceOwnedByOrg(wsId, orgId);
  res.json({ ok: true });
});

// 2. Per-site skip comment suppresses this specific read.
router.post("/skip-comment", async (req, res) => {
  // workspace-id-source-skip: read only for mismatch comparison
  const bodyWs = req.body?.workspaceId;
  res.json({ bodyWs });
});

// 3. Reading from a different non-body/non-query source is fine.
router.get("/from-session", async (req, res) => {
  // @ts-ignore
  const id = req.rbacUser?.workspaceId;
  res.json({ id });
});

// 4. Commented-out body read must not be flagged.
router.get("/commented", async (req, res) => {
  // const bad = req.body.workspaceId; // this was the old unsafe pattern
  res.json({ ok: true });
});

// 5. Header read is not in scope of this check.
router.get("/header", async (req, res) => {
  const id = req.headers["x-workspace-id"];
  res.json({ id });
});
