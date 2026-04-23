// All lines below should be flagged by check-workspace-id-source.
// No ownership helper is called or defined in this file.
import { Router } from "express";
const router = Router();

router.get("/dot", async (req, res) => {
  const id = req.body.workspaceId;
  res.json({ id });
});

router.get("/optional-chain", async (req, res) => {
  const id = req.body?.workspaceId;
  res.json({ id });
});

router.get("/bracket-double", async (req, res) => {
  const id = req.body["workspaceId"];
  res.json({ id });
});

router.get("/bracket-single", async (req, res) => {
  const id = req.body['workspace_id'];
  res.json({ id });
});

router.get("/query-dot", async (req, res) => {
  const id = req.query.workspaceId;
  res.json({ id });
});

router.get("/query-optional-chain", async (req, res) => {
  const id = req.query?.workspace_id;
  res.json({ id });
});

router.post("/destructure", async (req, res) => {
  const { workspaceId } = req.body;
  res.json({ workspaceId });
});

router.post("/destructure-query", async (req, res) => {
  const { workspace_id: wsId } = req.query;
  res.json({ wsId });
});
