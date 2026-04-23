import { Router } from "express";
import { eq, desc, sql, inArray, and, avg } from "drizzle-orm";
import { db, proposedTasks, taskActivityLog, teamMembers, resolutionLibrary, workspaces, agencyOpsTasks } from "@workspace/db";
import crypto from "crypto";
import { getOrgId, requireRole } from "../../middleware/rbac";

const router = Router();

function orgWorkspaceFilter(req: import("express").Request) {
  const orgId = getOrgId(req);
  if (!orgId) return undefined;
  const userId = req.rbacUser?.id ?? null;
  return sql`(${proposedTasks.workspaceId} IN (SELECT ${workspaces.id} FROM ${workspaces} WHERE ${workspaces.organizationId} = ${orgId})${userId != null ? sql` OR (${proposedTasks.workspaceId} IS NULL AND ${proposedTasks.proposedBy} = ${userId})` : sql``})`;
}

router.get("/", async (req, res) => {
  try {
    const orgScope = orgWorkspaceFilter(req);
    const statusFilter = req.query.status as string | undefined;
    const conditions = orgScope
      ? statusFilter
        ? sql`${orgScope} AND ${proposedTasks.status} = ${statusFilter}`
        : orgScope
      : statusFilter
        ? eq(proposedTasks.status, statusFilter)
        : undefined;
    const rows = conditions
      ? await db.select().from(proposedTasks).where(conditions).orderBy(desc(proposedTasks.createdAt))
      : await db.select().from(proposedTasks).orderBy(desc(proposedTasks.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list proposed tasks");
    res.status(500).json({ error: "Failed to list tasks" });
  }
});

router.get("/count", async (req, res) => {
  try {
    const orgScope = orgWorkspaceFilter(req);
    const conditions = orgScope
      ? sql`${orgScope} AND ${proposedTasks.status} = 'pending'`
      : eq(proposedTasks.status, "pending");
    const [row] = await db
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(proposedTasks)
      .where(conditions);
    res.json({ count: row?.c ?? 0 });
  } catch {
    res.json({ count: 0 });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      platform, platformLabel, toolName, toolDisplayName,
      toolArgs, displayDiff, reasoning, snapshotId, comments,
    } = req.body as Record<string, unknown>;

    if (!platform || !toolName || !toolDisplayName || !toolArgs) {
      res.status(400).json({ error: "platform, toolName, toolDisplayName, and toolArgs are required" });
      return;
    }

    const user = req.rbacUser;
    const wsId = user?.workspaceId ?? null;

    const idempotencyKey = crypto.createHash("sha256")
      .update(JSON.stringify({ ws: wsId, tool: toolName, args: toolArgs }))
      .digest("hex")
      .substring(0, 40);

    // tenant-ownership-skip: idempotencyKey is sha256(wsId + tool + args) where
    // wsId comes from the authed session (req.rbacUser.workspaceId) — so the
    // key itself is workspace-scoped and collisions across tenants are
    // cryptographically infeasible.
    const existing = await db.select({ id: proposedTasks.id })
      .from(proposedTasks)
      .where(and(
        eq(proposedTasks.idempotencyKey, idempotencyKey),
        eq(proposedTasks.status, "pending"),
      ))
      .limit(1);

    if (existing.length > 0) {
      res.status(200).json({ ...existing[0], duplicate: true, message: "Identical pending task already exists." });
      return;
    }

    const [task] = await db.insert(proposedTasks).values({
      workspaceId: wsId,
      idempotencyKey,
      proposedBy: user?.id ?? null,
      proposedByName: user?.name || "Unknown",
      proposedByRole: user?.role || "analyst",
      platform: platform as string,
      platformLabel: (platformLabel as string) || (platform as string),
      toolName: toolName as string,
      toolDisplayName: toolDisplayName as string,
      toolArgs: toolArgs as Record<string, unknown>,
      displayDiff: displayDiff as Array<{ label: string; from: string; to: string }> | undefined,
      reasoning: (reasoning as string) || "",
      snapshotId: snapshotId as number | undefined,
      comments: (comments as string) || "",
      status: "pending",
    }).returning();

    res.status(201).json(task);
  } catch (err) {
    req.log.error({ err }, "Failed to create proposed task");
    res.status(500).json({ error: "Failed to create task" });
  }
});

router.post("/manual", async (req, res) => {
  try {
    const role = req.rbacUser?.role;
    if (role !== "admin" && role !== "manager") {
      res.status(403).json({ error: "Only Agency Principals and Account Directors can create manual tasks" });
      return;
    }
    const { title, platform, priority, description, assignee } = req.body as Record<string, unknown>;
    if (!title) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    const user = req.rbacUser;
    const wsId = user?.workspaceId ?? null;

    const [task] = await db.insert(proposedTasks).values({
      workspaceId: wsId,
      proposedBy: user?.id ?? null,
      proposedByName: user?.name || "Unknown",
      proposedByRole: user?.role || "admin",
      platform: (platform as string) || "internal",
      platformLabel: (platform as string) === "google_ads" ? "Google Ads"
        : (platform as string) === "meta" ? "Meta Ads"
        : (platform as string) === "shopify" ? "Shopify"
        : (platform as string) === "gmc" ? "Google Merchant Center"
        : (platform as string) === "gsc" ? "Google Search Console"
        : "Internal",
      toolName: "manual_task",
      toolDisplayName: title as string,
      toolArgs: { description: description || "", priority: priority || "medium", assignee: assignee || null },
      reasoning: (description as string) || "",
      comments: assignee ? `Assigned to ${assignee}` : "",
      status: "pending",
    }).returning();

    if (assignee && wsId) {
      const members = await db.select().from(teamMembers).where(
        sql`LOWER(${teamMembers.name}) = LOWER(${assignee}) AND ${teamMembers.workspaceId} = ${wsId}`,
      ).limit(1);
      if (members.length > 0) {
        // tenant-ownership-skip: `task` was just inserted in this handler with
        // the caller's wsId; updating by task.id is bound to that scope.
        await db.update(proposedTasks)
          .set({ assignedTo: members[0].id, assignedToName: members[0].name })
          .where(eq(proposedTasks.id, task.id));
      }
    }

    await db.insert(taskActivityLog).values({
      taskId: task.id,
      actorName: user?.name || "Unknown",
      actorRole: user?.role || "admin",
      action: "created",
      note: `Manually created task: ${title}`,
    });

    res.status(201).json(task);
  } catch (err) {
    req.log.error({ err }, "Failed to create manual task");
    res.status(500).json({ error: "Failed to create task" });
  }
});

router.patch("/:id/approve", async (req, res) => {
  try {
    const role = req.rbacUser?.role;
    if (role !== "admin" && role !== "manager") {
      res.status(403).json({ error: "Only Agency Principals and Account Directors can approve tasks" });
      return;
    }
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const resolvedByName = (req.rbacUser?.name) || "Unknown";
    const resolvedBy = req.rbacUser?.id;

    const orgScope = orgWorkspaceFilter(req);
    const whereConditions = orgScope
      ? and(eq(proposedTasks.id, id), orgScope)
      : eq(proposedTasks.id, id);

    const [updated] = await db
      .update(proposedTasks)
      .set({
        status: "approved",
        resolvedBy,
        resolvedByName,
        resolvedAt: new Date(),
      })
      .where(whereConditions)
      .returning();

    if (!updated) { res.status(404).json({ error: "Task not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to approve task");
    res.status(500).json({ error: "Failed to approve task" });
  }
});

router.patch("/:id/reject", async (req, res) => {
  try {
    const role = req.rbacUser?.role;
    if (role !== "admin" && role !== "manager") {
      res.status(403).json({ error: "Only Agency Principals and Account Directors can reject tasks" });
      return;
    }
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const resolvedByName = (req.rbacUser?.name) || "Unknown";
    const resolvedBy = req.rbacUser?.id;

    const orgScope = orgWorkspaceFilter(req);
    const whereConditions = orgScope
      ? and(eq(proposedTasks.id, id), orgScope)
      : eq(proposedTasks.id, id);

    const [updated] = await db
      .update(proposedTasks)
      .set({
        status: "rejected",
        resolvedBy,
        resolvedByName,
        resolvedAt: new Date(),
      })
      .where(whereConditions)
      .returning();

    if (!updated) { res.status(404).json({ error: "Task not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to reject task");
    res.status(500).json({ error: "Failed to reject task" });
  }
});

router.patch("/bulk-approve", async (req, res) => {
  try {
    const role = req.rbacUser?.role;
    if (role !== "admin" && role !== "manager") {
      res.status(403).json({ error: "Only Agency Principals and Account Directors can approve tasks" });
      return;
    }

    const { ids } = req.body as { ids?: number[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "ids array is required" });
      return;
    }
    if (ids.length > 50) {
      res.status(400).json({ error: "Maximum 50 tasks per bulk action" });
      return;
    }

    const resolvedByName = req.rbacUser?.name || "Unknown";
    const resolvedBy = req.rbacUser?.id;

    const orgScope = orgWorkspaceFilter(req);
    const whereConditions = orgScope
      ? and(inArray(proposedTasks.id, ids), eq(proposedTasks.status, "pending"), orgScope)
      : and(inArray(proposedTasks.id, ids), eq(proposedTasks.status, "pending"));

    const updated = await db
      .update(proposedTasks)
      .set({
        status: "approved",
        resolvedBy,
        resolvedByName,
        resolvedAt: new Date(),
      })
      .where(whereConditions)
      .returning();

    res.json({ approved: updated.length, tasks: updated });
  } catch (err) {
    req.log.error({ err }, "Failed to bulk approve tasks");
    res.status(500).json({ error: "Failed to bulk approve tasks" });
  }
});

// SEC-08: Use requireRole("manager") so the rejection is logged to auditLogs
// and short-circuits before any DB work — instead of an inline check that
// silently bypassed the audit trail.
router.post("/:id/transfer", requireRole("manager"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { targetMemberId, note } = req.body as { targetMemberId?: number; note?: string };
    if (!targetMemberId) { res.status(400).json({ error: "targetMemberId is required" }); return; }

    const [targetMember] = await db.select().from(teamMembers).where(eq(teamMembers.id, targetMemberId));
    if (!targetMember) { res.status(404).json({ error: "Target team member not found" }); return; }

    const orgScope = orgWorkspaceFilter(req);
    const whereConditions = orgScope
      ? and(eq(proposedTasks.id, id), orgScope)
      : eq(proposedTasks.id, id);

    const [task] = await db.select().from(proposedTasks).where(whereConditions);
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    await db.update(proposedTasks)
      .set({ assignedTo: targetMemberId, assignedToName: targetMember.name })
      .where(eq(proposedTasks.id, id));

    await db.insert(taskActivityLog).values({
      taskId: id,
      actorId: req.rbacUser?.id,
      actorName: req.rbacUser?.name || "Unknown",
      actorRole: req.rbacUser?.role || "analyst",
      action: "transfer",
      note: note || "",
      targetMemberId,
      targetMemberName: targetMember.name,
    });

    res.json({ success: true, assignedTo: targetMember.name });
  } catch (err) {
    req.log.error({ err }, "Failed to transfer task");
    res.status(500).json({ error: "Failed to transfer task" });
  }
});

router.get("/:id/activity", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const orgScope = orgWorkspaceFilter(req);
    const taskWhere = orgScope
      ? and(eq(proposedTasks.id, id), orgScope)
      : eq(proposedTasks.id, id);
    const [task] = await db.select({ id: proposedTasks.id }).from(proposedTasks).where(taskWhere);
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    const activity = await db.select()
      .from(taskActivityLog)
      .where(eq(taskActivityLog.taskId, id))
      .orderBy(desc(taskActivityLog.createdAt));

    res.json(activity);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch activity log");
    res.status(500).json({ error: "Failed to fetch activity log" });
  }
});

router.post("/:id/save-to-library", async (req, res) => {
  try {
    const role = req.rbacUser?.role;
    if (role !== "admin" && role !== "manager") {
      res.status(403).json({ error: "Only Agency Principals and Account Directors can save to library" });
      return;
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const wsId = req.rbacUser?.workspaceId;
    const taskWhere = wsId
      ? and(eq(proposedTasks.id, id), eq(proposedTasks.workspaceId, wsId))
      : eq(proposedTasks.id, id);
    const [task] = await db.select().from(proposedTasks).where(taskWhere);
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    if (task.status !== "approved") {
      res.status(400).json({ error: "Only approved tasks can be saved to the resolution library" });
      return;
    }

    const { tags, originalProblem } = req.body as { tags?: string[]; originalProblem?: string };

    const [entry] = await db.insert(resolutionLibrary).values({
      workspaceId: task.workspaceId,
      taskId: task.id,
      savedBy: req.rbacUser?.id,
      savedByName: req.rbacUser?.name || "Unknown",
      platform: task.platform,
      platformLabel: task.platformLabel,
      toolName: task.toolName,
      toolDisplayName: task.toolDisplayName,
      toolArgs: task.toolArgs,
      originalProblem: originalProblem || task.reasoning || task.toolDisplayName,
      reasoning: task.reasoning,
      displayDiff: task.displayDiff,
      tags: tags || [],
    }).returning();

    await db.insert(taskActivityLog).values({
      taskId: id,
      actorId: req.rbacUser?.id,
      actorName: req.rbacUser?.name || "Unknown",
      actorRole: req.rbacUser?.role || "admin",
      action: "saved_to_library",
      note: "Saved to Team Resolution Base",
    });

    res.json(entry);
  } catch (err) {
    req.log.error({ err }, "Failed to save to library");
    res.status(500).json({ error: "Failed to save to library" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Agency Operational Tasks  (/api/tasks/ops)
// Scoped to organizationId so directors see work across all client workspaces.
// Separate from proposed_tasks (AI campaign-action proposals).
// ══════════════════════════════════════════════════════════════════════════════

const OPS_DEMO_SEED = (orgId: number) => [
  { organizationId: orgId, title: "Q2 Campaign Launch — Acme Corp",        description: "Brief, asset handoff, and platform activation for Q2 push.",         priority: "high",   status: "in_progress", assignedToName: "Priya Mehta",       messagesExchanged: 14, avgResponseTimeHours: 1.2, createdByName: "James Harrington" },
  { organizationId: orgId, title: "Shopify Feed Audit — BlueWave",         description: "Identify broken product variants and fix GMC disapprovals.",          priority: "high",   status: "not_started", assignedToName: "Carlos Rivera",     messagesExchanged: 3,  avgResponseTimeHours: 4.5, createdByName: "Priya Mehta"       },
  { organizationId: orgId, title: "Monthly P&L Report — Internal",         description: "Compile gross margin and EBITDA across all client accounts.",          priority: "medium", status: "completed",   assignedToName: "Aisha Okonkwo",     messagesExchanged: 8,  avgResponseTimeHours: 2.1, createdByName: "James Harrington" },
  { organizationId: orgId, title: "Google Ads Restructure — Apex Brands",  description: "Rebuild campaign tree to match new product taxonomy.",                priority: "high",   status: "in_progress", assignedToName: "David Ng",          messagesExchanged: 22, avgResponseTimeHours: 0.8, createdByName: "Sarah Kowalski"   },
  { organizationId: orgId, title: "Onboard New Client — Zephyr Retail",    description: "Complete intake form, workspace setup, and initial data sync.",        priority: "medium", status: "not_started", assignedToName: "Lena Fischer",      messagesExchanged: 1,  avgResponseTimeHours: 0.0, createdByName: "Tom Whitfield"    },
  { organizationId: orgId, title: "Meta Creative Refresh — Meridian",      description: "Upload 3 new ad sets with seasonal creative and update UTM params.",   priority: "low",    status: "completed",   assignedToName: "Sarah Kowalski",    messagesExchanged: 6,  avgResponseTimeHours: 3.3, createdByName: "Aisha Okonkwo"    },
  { organizationId: orgId, title: "Budget Pacing Review — All Accounts",   description: "Ensure all clients are within ±5% of monthly pacing targets.",        priority: "medium", status: "in_progress", assignedToName: "Tom Whitfield",     messagesExchanged: 10, avgResponseTimeHours: 1.9, createdByName: "David Ng"          },
  { organizationId: orgId, title: "API Credentials Rotation — IT",         description: "Rotate expired OAuth tokens for Google, Meta, and Shopify.",           priority: "high",   status: "not_started", assignedToName: "Lena Fischer",      messagesExchanged: 2,  avgResponseTimeHours: 5.0, createdByName: "Carlos Rivera"    },
];

// GET /api/tasks/ops
router.get("/ops", async (req, res): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) { res.status(401).json({ error: "No organisation context" }); return; }

    let rows = await db
      .select()
      .from(agencyOpsTasks)
      .where(eq(agencyOpsTasks.organizationId, orgId))
      .orderBy(
        sql`CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`,
        desc(agencyOpsTasks.createdAt),
      );

    // Seed demo data for empty organisations
    if (rows.length === 0) {
      try {
        await db.insert(agencyOpsTasks).values(OPS_DEMO_SEED(orgId)).onConflictDoNothing();
        rows = await db
          .select()
          .from(agencyOpsTasks)
          .where(eq(agencyOpsTasks.organizationId, orgId))
          .orderBy(
            sql`CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`,
            desc(agencyOpsTasks.createdAt),
          );
      } catch (seedErr) {
        req.log.warn({ seedErr, orgId }, "[OPS Tasks] Seed insert failed");
      }
    }

    // Status counts
    const counts = { not_started: 0, in_progress: 0, completed: 0 };
    let totalMessages = 0;
    let totalResponseTime = 0;
    for (const r of rows) {
      const s = r.status as keyof typeof counts;
      if (s in counts) counts[s]++;
      totalMessages     += r.messagesExchanged;
      totalResponseTime += r.avgResponseTimeHours;
    }

    const totals = {
      ...counts,
      total:              rows.length,
      avgMessagesPerTask: rows.length ? parseFloat((totalMessages / rows.length).toFixed(1)) : 0,
      avgResponseTimeHours: rows.length ? parseFloat((totalResponseTime / rows.length).toFixed(1)) : 0,
      totalMessages,
    };

    res.json({ tasks: rows, totals, organizationId: orgId, syncedAt: Date.now() });
  } catch (err) {
    req.log.error({ err }, "[OPS Tasks] GET /ops failed");
    res.status(500).json({ error: "Failed to load operational tasks" });
  }
});

// POST /api/tasks/ops — create a new operational task
router.post("/ops", async (req, res): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) { res.status(401).json({ error: "No organisation context" }); return; }

    const {
      title, description, priority, dueDate,
      status, assignedTo, assignedToName,
      messagesExchanged, avgResponseTimeHours,
    } = req.body as Record<string, unknown>;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    const [created] = await db
      .insert(agencyOpsTasks)
      .values({
        organizationId:       orgId,
        title:                String(title).trim(),
        description:          typeof description === "string" ? description : "",
        priority:             ["high", "medium", "low"].includes(String(priority)) ? String(priority) : "medium",
        dueDate:              dueDate ? new Date(String(dueDate)) : undefined,
        status:               ["not_started", "in_progress", "completed"].includes(String(status)) ? String(status) : "not_started",
        assignedTo:           typeof assignedTo === "number" ? assignedTo : undefined,
        assignedToName:       typeof assignedToName === "string" ? assignedToName : "",
        messagesExchanged:    typeof messagesExchanged === "number" ? messagesExchanged : 0,
        avgResponseTimeHours: typeof avgResponseTimeHours === "number" ? avgResponseTimeHours : 0,
        createdBy:            req.rbacUser?.id,
        createdByName:        req.rbacUser?.name || "Unknown",
      })
      .returning();

    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "[OPS Tasks] POST /ops failed");
    res.status(500).json({ error: "Failed to create task" });
  }
});

// PATCH /api/tasks/ops/:id — update status, priority, or assignee
router.patch("/ops/:id", async (req, res): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) { res.status(401).json({ error: "No organisation context" }); return; }

    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid task id" }); return; }

    const {
      status, priority, assignedToName,
      messagesExchanged, avgResponseTimeHours, dueDate,
    } = req.body as Record<string, unknown>;

    const patch: Partial<typeof agencyOpsTasks.$inferInsert> = { updatedAt: new Date() };
    if (typeof status === "string" && ["not_started", "in_progress", "completed"].includes(status))
      patch.status = status;
    if (typeof priority === "string" && ["high", "medium", "low"].includes(priority))
      patch.priority = priority;
    if (typeof assignedToName === "string") patch.assignedToName = assignedToName;
    if (typeof messagesExchanged === "number") patch.messagesExchanged = messagesExchanged;
    if (typeof avgResponseTimeHours === "number") patch.avgResponseTimeHours = avgResponseTimeHours;
    if (dueDate) patch.dueDate = new Date(String(dueDate));

    const [updated] = await db
      .update(agencyOpsTasks)
      .set(patch)
      .where(and(eq(agencyOpsTasks.id, id), eq(agencyOpsTasks.organizationId, orgId)))
      .returning();

    if (!updated) { res.status(404).json({ error: "Task not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "[OPS Tasks] PATCH /ops/:id failed");
    res.status(500).json({ error: "Failed to update task" });
  }
});

export default router;
