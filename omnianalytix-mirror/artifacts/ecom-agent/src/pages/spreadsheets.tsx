import { useState, useEffect, useMemo, useCallback } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { cn } from "@/lib/utils";
import { Search, Plus, Trash2, Download, Table2, FileSpreadsheet, Loader2, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DataInputModal } from "@/components/data/data-input-modal";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Dataset {
  id: number;
  name: string;
  tableName: string;
  columns: string[];
  rowCount: number;
  fileSize: number | null;
  createdAt: string;
}

interface TableRow {
  [key: string]: string | number | null;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="w-20 h-20 rounded-3xl bg-primary-container/20 flex items-center justify-center mb-6">
        <FileSpreadsheet className="w-10 h-10 text-primary-m3" />
      </div>
      <h3 className="text-xl font-semibold text-on-surface mb-2">No spreadsheets yet</h3>
      <p className="text-on-surface-variant text-sm mb-6 text-center max-w-sm">
        Upload a CSV file to get started. Your data will be stored securely and available for analysis.
      </p>
      <button
        onClick={onUpload}
        className="px-6 py-3 bg-primary-m3 text-white rounded-3xl font-medium hover:bg-primary-m3/90 transition-colors flex items-center gap-2"
      >
        <Plus className="w-4 h-4" />
        Upload Data
      </button>
    </div>
  );
}

function DatasetCard({
  dataset,
  active,
  onSelect,
  onDelete,
}: {
  dataset: Dataset;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      onClick={onSelect}
      className={cn(
        "p-4 rounded-2xl border cursor-pointer transition-all group",
        active
          ? "border-primary-m3 bg-primary-container/10 shadow-sm"
          : "ghost-border bg-white hover:border-primary-m3/30 hover:shadow-sm",
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", active ? "bg-primary-m3/15" : "bg-surface-variant/40")}>
            <Table2 className={cn("w-4.5 h-4.5", active ? "text-primary-m3" : "text-on-surface-variant")} />
          </div>
          <div>
            <p className="font-medium text-sm text-on-surface leading-tight">{dataset.name}</p>
            <p className="text-xs text-on-surface-variant mt-0.5">
              {dataset.rowCount.toLocaleString()} {dataset.rowCount === 1 ? "row" : "rows"} &middot; {dataset.columns.length} {dataset.columns.length === 1 ? "col" : "cols"}
            </p>
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-error-container/20 transition-all"
        >
          <Trash2 className="w-3.5 h-3.5 text-error" />
        </button>
      </div>
      <div className="flex items-center gap-3 text-xs text-on-surface-variant">
        <span>{formatBytes(dataset.fileSize)}</span>
        <span>&middot;</span>
        <span>{timeAgo(dataset.createdAt)}</span>
      </div>
    </motion.div>
  );
}

export default function Spreadsheets() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [rows, setRows] = useState<TableRow[]>([]);
  const [tableLoading, setTableLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const PAGE_SIZE = 100;

  const activeDataset = datasets.find((d) => d.id === activeId);

  const fetchDatasets = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/data-upload/datasets`);
      if (res.ok) {
        const data = await res.json();
        setDatasets(data);
        if (data.length > 0 && !activeId) setActiveId(data[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => { fetchDatasets(); }, []);

  useEffect(() => {
    if (!activeDataset) { setRows([]); return; }
    setTableLoading(true);
    setPage(0);
    authFetch(`${BASE}/api/data-upload/datasets/${activeDataset.id}/rows`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setRows(data))
      .catch(() => setRows([]))
      .finally(() => setTableLoading(false));
  }, [activeDataset?.id]);

  const handleDelete = async (id: number) => {
    const res = await authFetch(`${BASE}/api/data-upload/datasets/${id}`, { method: "DELETE" });
    if (res.ok) {
      setDatasets((prev) => prev.filter((d) => d.id !== id));
      if (activeId === id) setActiveId(datasets.find((d) => d.id !== id)?.id ?? null);
    }
  };

  const handleUploadClick = () => { setUploadOpen(true); };

  const handleUploaded = (ds: any) => {
    setDatasets((prev) => [ds, ...prev]);
    setActiveId(ds.id);
  };

  const filteredRows = useMemo(() => {
    let result = rows;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((r) =>
        Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)),
      );
    }
    if (sortCol) {
      result = [...result].sort((a, b) => {
        const va = a[sortCol] ?? "";
        const vb = b[sortCol] ?? "";
        const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return result;
  }, [rows, search, sortCol, sortDir]);

  const pagedRows = filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filteredRows.length / PAGE_SIZE);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  };

  const handleExport = () => {
    if (!activeDataset || rows.length === 0) return;
    const cols = activeDataset.columns;
    const csvLines = [cols.join(",")];
    rows.forEach((r) => {
      csvLines.push(cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","));
    });
    const blob = new Blob([csvLines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeDataset.name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-primary-m3" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">Spreadsheets</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Browse, search, and manage your uploaded datasets
          </p>
        </div>
        <button
          onClick={handleUploadClick}
          className="px-5 py-2.5 bg-primary-m3 text-white rounded-3xl font-medium hover:bg-primary-m3/90 transition-colors flex items-center gap-2 text-sm"
        >
          <Plus className="w-4 h-4" />
          Upload CSV
        </button>
      </div>

      {datasets.length === 0 ? (
        <EmptyState onUpload={handleUploadClick} />
      ) : (
        <div className="flex gap-6">
          <div className="w-72 flex-shrink-0 space-y-2">
            <AnimatePresence mode="popLayout">
              {datasets.map((ds) => (
                <DatasetCard
                  key={ds.id}
                  dataset={ds}
                  active={ds.id === activeId}
                  onSelect={() => setActiveId(ds.id)}
                  onDelete={() => handleDelete(ds.id)}
                />
              ))}
            </AnimatePresence>
          </div>

          <div className="flex-1 bg-white rounded-2xl border ghost-border overflow-hidden">
            {activeDataset && (
              <>
                <div className="px-5 py-4 border-b ghost-border flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search rows..."
                        className="pl-9 pr-4 py-2 rounded-xl bg-surface-variant/30 text-sm border-none outline-none focus:ring-2 ring-primary-m3/30 w-64"
                      />
                    </div>
                    <span className="text-xs text-on-surface-variant">
                      {filteredRows.length.toLocaleString()} rows
                    </span>
                  </div>
                  <button
                    onClick={handleExport}
                    className="px-4 py-2 text-sm rounded-xl ghost-border hover:bg-surface-variant/30 transition-colors flex items-center gap-2 text-on-surface-variant"
                  >
                    <Download className="w-4 h-4" />
                    Export
                  </button>
                </div>

                {tableLoading ? (
                  <div className="flex items-center justify-center h-64">
                    <Loader2 className="w-6 h-6 animate-spin text-primary-m3" />
                  </div>
                ) : (
                  <div className="overflow-auto max-h-[calc(100dvh-280px)]">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-surface-variant/20 z-10">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-on-surface-variant uppercase tracking-wider w-12">
                            #
                          </th>
                          {activeDataset.columns.map((col) => (
                            <th
                              key={col}
                              onClick={() => handleSort(col)}
                              className="px-4 py-3 text-left text-xs font-medium text-on-surface-variant uppercase tracking-wider cursor-pointer hover:text-on-surface transition-colors select-none"
                            >
                              <span className="flex items-center gap-1">
                                {col}
                                {sortCol === col && (
                                  <ChevronDown
                                    className={cn("w-3 h-3 transition-transform", sortDir === "desc" && "rotate-180")}
                                  />
                                )}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/30">
                        {pagedRows.map((row, i) => (
                          <tr key={i} className="hover:bg-surface-variant/10 transition-colors">
                            <td className="px-4 py-2.5 text-xs text-on-surface-variant tabular-nums">
                              {page * PAGE_SIZE + i + 1}
                            </td>
                            {activeDataset.columns.map((col) => (
                              <td key={col} className="px-4 py-2.5 text-on-surface max-w-[240px] truncate">
                                {row[col] ?? <span className="text-on-surface-variant/50 italic">null</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {totalPages > 1 && (
                  <div className="px-5 py-3 border-t ghost-border flex items-center justify-between">
                    <span className="text-xs text-on-surface-variant">
                      Page {page + 1} of {totalPages}
                    </span>
                    <div className="flex gap-2">
                      <button
                        disabled={page === 0}
                        onClick={() => setPage((p) => p - 1)}
                        className="px-3 py-1.5 text-xs rounded-lg ghost-border hover:bg-surface-variant/30 disabled:opacity-40 transition-colors"
                      >
                        Previous
                      </button>
                      <button
                        disabled={page >= totalPages - 1}
                        onClick={() => setPage((p) => p + 1)}
                        className="px-3 py-1.5 text-xs rounded-lg ghost-border hover:bg-surface-variant/30 disabled:opacity-40 transition-colors"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <DataInputModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={handleUploaded} />
    </div>
  );
}
