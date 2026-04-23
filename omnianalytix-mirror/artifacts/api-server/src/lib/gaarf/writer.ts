/**
 * In-memory GAARF writer.
 *
 * Implements IResultWriter from google-ads-api-report-fetcher and collects
 * parsed rows into memory. Useful for returning GAARF query results via API.
 *
 * Usage:
 *   const writer = new ArrayWriter();
 *   await executor.execute("campaigns", queryText, [customerId], {}, writer);
 *   const { columns, rows } = writer.getResult();
 */

import type { IResultWriter, QueryElements } from "google-ads-api-report-fetcher";

export interface GaarfResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  scriptName: string;
  customerId: string;
}

export class ArrayWriter implements IResultWriter {
  private columns: string[] = [];
  private rows: unknown[][] = [];
  private _scriptName = "";
  private _customerId = "";

  beginScript(scriptName: string, query: QueryElements): void {
    this._scriptName = scriptName;
    this.columns = query.columnNames ?? [];
    this.rows = [];
  }

  beginCustomer(customerId: string): void {
    this._customerId = customerId;
  }

  addRow(
    _customerId: string,
    parsedRow: unknown[],
    _rawRow: Record<string, unknown>,
  ): void {
    this.rows.push(parsedRow);
  }

  endCustomer(_customerId: string): void {
    // nothing
  }

  endScript(): void {
    // nothing
  }

  getResult(): GaarfResult {
    return {
      columns: this.columns,
      rows: this.rows,
      rowCount: this.rows.length,
      scriptName: this._scriptName,
      customerId: this._customerId,
    };
  }

  /** Convert collected rows to an array of plain objects keyed by column name. */
  toObjects(): Record<string, unknown>[] {
    return this.rows.map((row) =>
      Object.fromEntries(this.columns.map((col, i) => [col, row[i]])),
    );
  }
}
