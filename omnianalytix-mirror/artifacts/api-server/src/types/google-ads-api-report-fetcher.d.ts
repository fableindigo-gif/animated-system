/**
 * Local ambient declarations for `google-ads-api-report-fetcher` (gaarf).
 *
 * The upstream package (v4.0.0) ships a broken `types` field in its
 * package.json that points at raw `.ts` source files instead of compiled
 * `.d.ts` declarations.  Those source files have un-narrowed `unknown`
 * catches and other strict-mode violations that pollute our own
 * `tsc --noEmit` output even though `skipLibCheck` is enabled
 * (skipLibCheck only skips `.d.ts`, not `.ts`).
 *
 * Until upstream fixes their `types` field, we shadow the package via a
 * `paths` mapping in tsconfig.json -> this file.  The shim only declares
 * the surface area that the api-server actually consumes; everything
 * else is typed as `any` to keep the shim small.
 *
 * TODO(follow-up #151): delete this file and the matching `paths` entry
 * in `artifacts/api-server/tsconfig.json` once `google-ads-api-report-fetcher`
 * publishes a release whose `types` field points at compiled `.d.ts`
 * declarations rather than raw `.ts` source.
 */

declare module "google-ads-api-report-fetcher" {
  export interface QueryElements {
    columnNames?: string[];
    [key: string]: unknown;
  }

  export interface IResultWriter {
    beginScript(scriptName: string, query: QueryElements): void | Promise<void>;
    beginCustomer(customerId: string): void | Promise<void>;
    addRow(
      customerId: string,
      parsedRow: unknown[],
      rawRow: Record<string, unknown>,
    ): void | Promise<void>;
    endCustomer(customerId: string): void | Promise<void>;
    endScript(): void | Promise<void>;
  }

  export interface GoogleAdsRestApiClientOptions {
    developer_token: string;
    client_id?: string;
    client_secret?: string;
    refresh_token?: string;
    login_customer_id?: string;
    customer_id?: string;
    [key: string]: unknown;
  }

  export class GoogleAdsRestApiClient {
    constructor(options: GoogleAdsRestApiClientOptions);
  }

  export class AdsQueryExecutor {
    constructor(client: GoogleAdsRestApiClient);
    parseQuery(
      queryText: string,
      scriptName: string,
      options?: { macros?: Record<string, string> },
    ): Promise<QueryElements>;
    executeOne(
      query: QueryElements,
      customerId: string,
      writer: IResultWriter,
      scriptName?: string,
    ): Promise<void>;
    execute(
      scriptName: string,
      queryText: string,
      customerIds: string[],
      macros: Record<string, string>,
      writer: IResultWriter,
    ): Promise<void>;
  }
}
