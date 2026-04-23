import { Router } from "express";
import { logger } from "../../lib/logger";
import { generateWorkerScript } from "../../lib/cloudflare-worker-template";

const router = Router();

const CF_API_BASE = "https://api.cloudflare.com/client/v4";
const SCRIPT_NAME = "omni-tag-gateway";

interface ProvisionRequest {
  cfApiToken: string;
  cfZoneId: string;
  proxyRoute: string;
  measurementId?: string;
}

interface CloudflareApiError {
  code: number;
  message: string;
}

interface CloudflareApiResponse {
  success: boolean;
  errors: CloudflareApiError[];
  result?: Record<string, unknown>;
}

async function cfFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<CloudflareApiResponse> {
  const resp = await fetch(`${CF_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...((options.headers as Record<string, string>) || {}),
    },
  });
  return resp.json() as Promise<CloudflareApiResponse>;
}

router.post("/provision-cloudflare-gateway", async (req, res) => {
  const { cfApiToken, cfZoneId, proxyRoute, measurementId } =
    req.body as ProvisionRequest;

  if (!cfApiToken || !cfZoneId || !proxyRoute) {
    res.status(400).json({
      success: false,
      error: "Missing required fields: cfApiToken, cfZoneId, proxyRoute.",
    });
    return;
  }

  const cleanRoute = proxyRoute
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/[a-zA-Z0-9._-]*)*$/.test(cleanRoute)) {
    res.status(400).json({
      success: false,
      error:
        "Invalid proxy route format. Expected: metrics.yourdomain.com or yourdomain.com/gtag",
    });
    return;
  }

  logger.info({ zoneId: cfZoneId, route: cleanRoute }, "cloudflare-gateway: provisioning started");

  try {
    const verifyResp = await cfFetch("/user/tokens/verify", cfApiToken);
    if (!verifyResp.success) {
      const errMsg =
        verifyResp.errors?.[0]?.message || "Token verification failed.";
      logger.warn("cloudflare-gateway: invalid API token");
      res.status(401).json({ success: false, error: `Invalid API Token: ${errMsg}` });
      return;
    }
  } catch (err) {
    logger.error({ err }, "cloudflare-gateway: token verification network error");
    res.status(502).json({
      success: false,
      error: "Could not reach Cloudflare API to verify your token. Please try again.",
    });
    return;
  }

  const workerScript = generateWorkerScript();

  try {
    const scriptResp = await cfFetch(
      `/accounts/${cfZoneId}/workers/scripts/${SCRIPT_NAME}`,
      cfApiToken,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/javascript",
        },
        body: workerScript,
      },
    );

    if (!scriptResp.success) {
      const zoneScriptResp = await cfFetch(
        `/zones/${cfZoneId}/workers/scripts/${SCRIPT_NAME}`,
        cfApiToken,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/javascript",
          },
          body: workerScript,
        },
      );

      if (!zoneScriptResp.success) {
        const errMsg =
          zoneScriptResp.errors?.[0]?.message ||
          scriptResp.errors?.[0]?.message ||
          "Worker script upload failed.";
        logger.warn({ errors: zoneScriptResp.errors }, "cloudflare-gateway: script upload failed");
        res.status(422).json({ success: false, error: `Worker Upload Error: ${errMsg}` });
        return;
      }
    }
  } catch (err) {
    logger.error({ err }, "cloudflare-gateway: script upload network error");
    res.status(502).json({
      success: false,
      error: "Network error uploading Worker script to Cloudflare.",
    });
    return;
  }

  logger.info("cloudflare-gateway: worker script uploaded");

  const routePattern = `${cleanRoute}/*`;
  let routeId: string | undefined;

  try {
    const routeResp = await cfFetch(
      `/zones/${cfZoneId}/workers/routes`,
      cfApiToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pattern: routePattern,
          script: SCRIPT_NAME,
        }),
      },
    );

    if (!routeResp.success) {
      const errMsg =
        routeResp.errors?.[0]?.message || "Route binding failed.";
      if (errMsg.toLowerCase().includes("already exists") || errMsg.toLowerCase().includes("duplicate")) {
        logger.info("cloudflare-gateway: route already exists — continuing");
      } else {
        logger.warn({ errors: routeResp.errors }, "cloudflare-gateway: route binding failed");
        res.status(422).json({ success: false, error: `Route Binding Error: ${errMsg}` });
        return;
      }
    } else {
      routeId = routeResp.result?.id as string | undefined;
    }
  } catch (err) {
    logger.error({ err }, "cloudflare-gateway: route binding network error");
    res.status(502).json({
      success: false,
      error: "Network error binding Worker route on Cloudflare.",
    });
    return;
  }

  logger.info({ routePattern, routeId }, "cloudflare-gateway: provisioning complete");

  const hasPath = cleanRoute.includes("/");
  const proxyDomain = hasPath ? cleanRoute : cleanRoute;
  const proxyBasePath = hasPath
    ? `https://${cleanRoute}`
    : `https://${cleanRoute}/gtag`;

  if (!measurementId) {
    res.status(400).json({ error: "A Google Analytics Measurement ID is required. Please provide it in the request or configure it in your workspace settings." });
    return;
  }

  const gtagSnippet = `<!-- Google Tag Gateway — First-Party Mode (Cloudflare Worker) -->
<script async src="${proxyBasePath}/js?id=${measurementId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${measurementId}', {
    server_container_url: '${proxyBasePath}',
    send_page_view: true
  });
</script>`;

  res.json({
    success: true,
    scriptName: SCRIPT_NAME,
    routePattern,
    routeId: routeId || "existing",
    proxyDomain,
    gtagSnippet,
    message: `Tag Gateway Worker deployed to ${routePattern}. Your conversion signals are now first-party.`,
  });
});

export default router;
