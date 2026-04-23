import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { authFetch } from "@/lib/auth-fetch";
import { cn } from "@/lib/utils";
import { Upload, FileSpreadsheet, X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface DataInputModalProps {
  open: boolean;
  onClose: () => void;
  onUploaded?: (dataset: { id: number; name: string; tableName: string; columns: string[]; rowCount: number }) => void;
}

type UploadState = "idle" | "uploading" | "success" | "error";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function DataInputModal({ open, onClose, onUploaded }: DataInputModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ name: string; rowCount: number; columns: string[] } | null>(null);

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length > 0) {
      setFile(accepted[0]);
      setState("idle");
      setError("");
      setResult(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/csv": [".csv"] },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
    onDropRejected: (rejections) => {
      const msg = rejections[0]?.errors?.[0]?.message || "Invalid file";
      setError(msg);
    },
  });

  const handleUpload = async () => {
    if (!file) return;
    setState("uploading");
    setError("");

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await authFetch(`${BASE}/api/data-upload/upload`, { method: "POST", body: form });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      const dataset = await res.json();
      setState("success");
      setResult({ name: dataset.name, rowCount: dataset.rowCount, columns: dataset.columns });
      onUploaded?.(dataset);
    } catch (err: any) {
      setState("error");
      setError(err.message || "Upload failed");
    }
  };

  const handleClose = () => {
    setFile(null);
    setState("idle");
    setError("");
    setResult(null);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/40 backdrop-blur-sm" onClick={handleClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md sm:mx-4 overflow-hidden max-h-[92dvh] sm:max-h-[85vh] overflow-y-auto"
      >
        <div className="px-6 py-5 border-b ghost-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-container/15 flex items-center justify-center">
              <Upload className="w-5 h-5 text-primary-m3" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-on-surface">Import Data</h2>
              <p className="text-xs text-on-surface-variant">Upload a CSV file (max 10 MB)</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-2 rounded-xl hover:bg-surface-variant/30 transition-colors">
            <X className="w-5 h-5 text-on-surface-variant" />
          </button>
        </div>

        <div className="p-6">
          <AnimatePresence mode="wait">
            {state === "success" && result ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center py-8"
              >
                <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-lg font-semibold text-on-surface mb-1">Upload Complete</h3>
                <p className="text-sm text-on-surface-variant mb-4 text-center">
                  <strong>{result.name}</strong> — {result.rowCount.toLocaleString()} {result.rowCount === 1 ? "row" : "rows"}, {result.columns.length} {result.columns.length === 1 ? "column" : "columns"}
                </p>
                <button
                  onClick={handleClose}
                  className="px-6 py-2.5 bg-primary-m3 text-white rounded-3xl font-medium hover:bg-primary-m3/90 transition-colors text-sm"
                >
                  Done
                </button>
              </motion.div>
            ) : (
              <motion.div key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div
                  {...getRootProps()}
                  className={cn(
                    "border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all",
                    isDragActive
                      ? "border-primary-m3 bg-primary-container/10"
                      : file
                        ? "border-primary-m3/40 bg-primary-container/5"
                        : "ghost-border hover:border-primary-m3/30 hover:bg-surface-variant/10",
                  )}
                >
                  <input {...getInputProps()} />
                  {file ? (
                    <div className="flex items-center gap-3 justify-center">
                      <FileSpreadsheet className="w-8 h-8 text-primary-m3" />
                      <div className="text-left">
                        <p className="text-sm font-medium text-on-surface">{file.name}</p>
                        <p className="text-xs text-on-surface-variant">{formatBytes(file.size)}</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setFile(null); setState("idle"); }}
                        className="p-1.5 rounded-lg hover:bg-surface-variant/40 ml-2"
                      >
                        <X className="w-4 h-4 text-on-surface-variant" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-10 h-10 text-on-surface-variant/50 mx-auto mb-3" />
                      <p className="text-sm text-on-surface mb-1">
                        {isDragActive ? "Drop your CSV here" : "Drag & drop a CSV file here"}
                      </p>
                      <p className="text-xs text-on-surface-variant">or click to browse</p>
                    </>
                  )}
                </div>

                {error && (
                  <div className="mt-4 flex items-start gap-2 text-xs text-error bg-error-container/10 px-3 py-2.5 rounded-xl">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="mt-5 flex justify-end gap-3">
                  <button
                    onClick={handleClose}
                    className="px-5 py-2.5 text-sm rounded-3xl ghost-border hover:bg-surface-variant/30 transition-colors text-on-surface-variant"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpload}
                    disabled={!file || state === "uploading"}
                    className="px-5 py-2.5 text-sm rounded-3xl bg-primary-m3 text-white font-medium hover:bg-primary-m3/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {state === "uploading" && <Loader2 className="w-4 h-4 animate-spin" />}
                    {state === "uploading" ? "Uploading..." : "Upload"}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
