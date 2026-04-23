import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const getCampaignPerformanceMock = vi.fn();
const getProductPerformanceMock = vi.fn();
const getProductIssuesMock = vi.fn();
const getAccountHealthMock = vi.fn();

vi.mock("../services/shopping-insider", () => ({
  getCampaignPerformance: (...args: unknown[]) => getCampaignPerformanceMock(...args),
  getProductPerformance: (...args: unknown[]) => getProductPerformanceMock(...args),
  getProductIssues: (...args: unknown[]) => getProductIssuesMock(...args),
  getAccountHealth: (...args: unknown[]) => getAccountHealthMock(...args),
}));

import shoppingRouter from "../routes/insights/shopping";

const EXPORT_LIMIT_CAP = 100000;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use("/insights/shopping", shoppingRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  getCampaignPerformanceMock.mockReset();
  getProductPerformanceMock.mockReset();
  getProductIssuesMock.mockReset();
  getAccountHealthMock.mockReset();
});

describe("GET /insights/shopping/campaigns?format=csv", () => {
  it("streams CSV with correct headers, filename, columns, and escaped values", async () => {
    getCampaignPerformanceMock.mockResolvedValue([
      {
        campaign_id: "c1",
        campaign_name: 'Summer "Sale", 2025',
        customer_id: "123",
        impressions: 1000,
        clicks: 50,
        ctr: 0.05,
        cost: 12.5,
        conversions: 3,
        conversion_value: 99.9,
        cpc: 0.25,
        roas: 7.99,
      },
      {
        campaign_id: "c2",
        campaign_name: "Line\nbreak campaign",
        customer_id: "123",
        impressions: 0,
        clicks: 0,
        ctr: 0,
        cost: 0,
        conversions: 0,
        conversion_value: 0,
        cpc: 0,
        roas: 0,
      },
    ]);

    const res = await fetch(
      `${baseUrl}/insights/shopping/campaigns?format=csv&start_date=2025-01-01&end_date=2025-01-31`,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="shopping-insights-campaigns_2025-01-01_2025-01-31.csv"',
    );

    const body = await res.text();
    expect(body).toBe(
      "campaign_id,campaign_name,customer_id,impressions,clicks,ctr,cost,conversions,conversion_value,cpc,roas\n" +
        'c1,"Summer ""Sale"", 2025",123,1000,50,0.05,12.5,3,99.9,0.25,7.99\n' +
        'c2,"Line\nbreak campaign",123,0,0,0,0,0,0,0,0\n',
    );
  });

  it("defaults to the export cap when no limit is provided", async () => {
    getCampaignPerformanceMock.mockResolvedValue([]);
    const res = await fetch(`${baseUrl}/insights/shopping/campaigns?format=csv`);
    expect(res.status).toBe(200);
    expect(getCampaignPerformanceMock).toHaveBeenCalledTimes(1);
    expect(getCampaignPerformanceMock.mock.calls[0][0]).toMatchObject({ limit: EXPORT_LIMIT_CAP });
  });

  it("respects an explicit limit query parameter", async () => {
    getCampaignPerformanceMock.mockResolvedValue([]);
    const res = await fetch(`${baseUrl}/insights/shopping/campaigns?format=csv&limit=42`);
    expect(res.status).toBe(200);
    expect(getCampaignPerformanceMock.mock.calls[0][0]).toMatchObject({ limit: 42 });
  });
});

describe("GET /insights/shopping/products?format=csv", () => {
  it("streams CSV with correct headers, filename, columns, and escaped values", async () => {
    getProductPerformanceMock.mockResolvedValue([
      {
        offer_id: "sku-1",
        title: 'Widget, "Pro"',
        brand: "Acme",
        product_type: "Tools > Widgets",
        merchant_id: "m1",
        country: "US",
        impressions: 200,
        clicks: 10,
        cost: 5,
        conversions: 1,
        conversion_value: 25,
        roas: 5,
      },
    ]);

    const res = await fetch(
      `${baseUrl}/insights/shopping/products?format=csv&direction=top&start_date=2025-02-01&end_date=2025-02-28`,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="shopping-insights-products-top_2025-02-01_2025-02-28.csv"',
    );

    const body = await res.text();
    const lines = body.split("\n");
    expect(lines[0]).toBe(
      "offer_id,title,brand,product_type,merchant_id,country,impressions,clicks,cost,conversions,conversion_value,roas",
    );
    expect(lines[1]).toBe(
      'sku-1,"Widget, ""Pro""",Acme,Tools > Widgets,m1,US,200,10,5,1,25,5',
    );
  });

  it("defaults to the export cap when no limit is provided", async () => {
    getProductPerformanceMock.mockResolvedValue([]);
    const res = await fetch(`${baseUrl}/insights/shopping/products?format=csv`);
    expect(res.status).toBe(200);
    expect(getProductPerformanceMock.mock.calls[0][0]).toMatchObject({ limit: EXPORT_LIMIT_CAP });
  });

  it("respects an explicit limit query parameter", async () => {
    getProductPerformanceMock.mockResolvedValue([]);
    const res = await fetch(`${baseUrl}/insights/shopping/products?format=csv&limit=7`);
    expect(res.status).toBe(200);
    expect(getProductPerformanceMock.mock.calls[0][0]).toMatchObject({ limit: 7 });
  });
});

describe("GET /insights/shopping/issues?format=csv", () => {
  it("streams CSV with correct headers, filename, columns, and escaped values", async () => {
    getProductIssuesMock.mockResolvedValue([
      {
        offer_id: "sku-9",
        title: "Some, item\r\nwrapped",
        merchant_id: "m9",
        country: "GB",
        destination: "Shopping",
        servability: "disapproved",
        issue_code: "image_link_broken",
        issue_description: 'broken "image" link',
        detail: "see help center",
        num_items: 3,
      },
    ]);

    const res = await fetch(`${baseUrl}/insights/shopping/issues?format=csv`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/csv/);
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(
      /^attachment; filename="shopping-insights-disapprovals_\d{4}-\d{2}-\d{2}\.csv"$/,
    );

    const body = await res.text();
    expect(body).toBe(
      "offer_id,title,merchant_id,country,destination,servability,issue_code,issue_description,detail,num_items\n" +
        'sku-9,"Some, item\r\nwrapped",m9,GB,Shopping,disapproved,image_link_broken,"broken ""image"" link",see help center,3\n',
    );
  });

  it("defaults to the export cap when no limit is provided", async () => {
    getProductIssuesMock.mockResolvedValue([]);
    const res = await fetch(`${baseUrl}/insights/shopping/issues?format=csv`);
    expect(res.status).toBe(200);
    expect(getProductIssuesMock.mock.calls[0][0]).toMatchObject({ limit: EXPORT_LIMIT_CAP });
  });

  it("respects an explicit limit query parameter", async () => {
    getProductIssuesMock.mockResolvedValue([]);
    const res = await fetch(`${baseUrl}/insights/shopping/issues?format=csv&limit=15`);
    expect(res.status).toBe(200);
    expect(getProductIssuesMock.mock.calls[0][0]).toMatchObject({ limit: 15 });
  });
});
