// The ownership helper is mentioned only in a comment — must NOT satisfy the check.
// This file should be flagged exactly like should-fail.ts.
import { Router } from "express";

// TODO: call assertWorkspaceOwnedByOrg( before using workspaceId
const router = Router();

router.post("/danger", async (req, res) => {
  const wsId = req.body.workspaceId;
  res.json({ wsId });
});
