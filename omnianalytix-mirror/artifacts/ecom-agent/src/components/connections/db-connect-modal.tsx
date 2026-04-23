import { useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { cn } from "@/lib/utils";
import { X, Loader2, CheckCircle2, AlertCircle, Eye, EyeOff, Upload, Database } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type DbType = "postgres" | "mysql" | "snowflake" | "bigquery";

interface DbConnectModalProps {
  open: boolean;
  dbType: DbType;
  onClose: () => void;
  onConnected?: () => void;
}

const DB_CONFIG: Record<DbType, { label: string; defaultPort: number; color: string; icon: React.ReactNode }> = {
  postgres: {
    label: "PostgreSQL",
    defaultPort: 5432,
    color: "#336791",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
        <path d="M17.128 0a10.134 10.134 0 0 0-2.755.403l-.063.02A10.922 10.922 0 0 0 12.6.258C11.422.238 10.41.524 9.594 1 8.79.721 7.122.24 5.364.336 4.14.403 2.804.775 1.814 1.82.826 2.865.377 4.486.55 6.6c.046.559.556 2.765 1.29 4.75.367.993.79 1.977 1.308 2.756.26.39.56.752.924 1.025.182.137.39.25.629.305a1.08 1.08 0 0 0 .652-.052c.472-.196.795-.588 1.088-.995.297-.411.574-.88.881-1.32l.043.036c.064.548.12 1.09.245 1.6s.33 1 .688 1.393c.146.16.33.295.547.381a1.2 1.2 0 0 0 .692.06c.437-.089.77-.39 1.04-.715.267-.325.482-.7.677-1.083l.07.001c.851-.013 1.63-.216 2.287-.536 1.107.865 2.434 1.315 3.67 1.252 1.033-.053 2.03-.443 2.744-1.226.713-.783 1.1-1.908 1.074-3.383l-.003-.18c.39-.443.72-.976.982-1.58.72-1.658 1.01-3.725.952-5.283a5.45 5.45 0 0 0-.095-.818C21.355 1.707 19.461.06 17.128 0z" fill="#336791"/>
      </svg>
    ),
  },
  mysql: {
    label: "MySQL",
    defaultPort: 3306,
    color: "#00758F",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15H9v-2h2v2zm4 0h-2v-2h2v2zm-2-4H9V7h4v6z" fill="#00758F"/>
        <text x="7" y="18" fill="white" fontSize="8" fontWeight="bold" fontFamily="sans-serif">My</text>
      </svg>
    ),
  },
  snowflake: {
    label: "Snowflake",
    defaultPort: 443,
    color: "#29B5E8",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
        <path d="M12.394 21.001l-.002-.024-.009-.112a2.673 2.673 0 0 1 .016-.434 2.52 2.52 0 0 1 .19-.672l2.5-5.777L24 12.005l-8.91-1.977-2.501-5.777a2.52 2.52 0 0 1-.19-.672 2.673 2.673 0 0 1-.006-.546l.002-.024.009-.112c.01-.126.024-.237.048-.34L12 1l-.447 1.556c.024.104.038.215.048.341l.009.112.002.024a2.673 2.673 0 0 1-.016.434 2.52 2.52 0 0 1-.19.672L8.905 9.916l-.003.002L0 12.005l8.91 1.977 2.501 5.777c.09.208.153.432.19.672.027.173.026.35.016.434l-.009.112-.002.024-.009.112c-.01.126-.024.237-.048.34L12 23l.447-1.556a3.45 3.45 0 0 1-.048-.341l-.005-.102z" fill="#29B5E8"/>
      </svg>
    ),
  },
  bigquery: {
    label: "Google BigQuery",
    defaultPort: 443,
    color: "#4285F4",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
        <path d="M6.22 7.23l5.02 5.02-1.4 1.4-5.02-5.01 1.4-1.41zm8.17-1.59l-1.41-1.42-5.58 5.59 1.41 1.41 5.58-5.58zm2.12 2.12l-5.58 5.59 1.41 1.41 5.58-5.58-1.41-1.42zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="#4285F4"/>
      </svg>
    ),
  },
};

export function DbConnectModal({ open, dbType, onClose, onConnected }: DbConnectModalProps) {
  const config = DB_CONFIG[dbType];
  const [host, setHost] = useState("");
  const [port, setPort] = useState(String(config.defaultPort));
  const [databaseName, setDatabaseName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [serviceAccountKey, setServiceAccountKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latencyMs?: number; tableCount?: number; sampleTables?: string[] } | null>(null);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState<number | null>(null);

  const isBigQuery = dbType === "bigquery";

  const resetForm = () => {
    setHost("");
    setPort(String(config.defaultPort));
    setDatabaseName("");
    setUsername("");
    setPassword("");
    setLabel("");
    setServiceAccountKey("");
    setShowPassword(false);
    setSaving(false);
    setTesting(false);
    setTestResult(null);
    setError("");
    setSavedId(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSave = async () => {
    if (!host.trim() && !isBigQuery) { setError("Host is required"); return; }
    if (!databaseName.trim()) { setError("Database name is required"); return; }
    if (!username.trim()) { setError("Username is required"); return; }
    if (!password.trim() && !isBigQuery) { setError("Password is required"); return; }

    setSaving(true);
    setError("");
    try {
      const res = await authFetch(`${BASE}/api/byodb/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dbType,
          label: label.trim() || undefined,
          host: host.trim() || (isBigQuery ? "bigquery.googleapis.com" : ""),
          port: parseInt(port, 10) || config.defaultPort,
          databaseName: databaseName.trim(),
          username: username.trim(),
          password: password || "",
          serviceAccountKey: isBigQuery ? serviceAccountKey : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save");
        return;
      }
      const cred = await res.json();
      setSavedId(cred.id);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!savedId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await authFetch(`${BASE}/api/byodb/credentials/${savedId}/test`, { method: "POST" });
      if (res.ok) {
        const result = await res.json();
        setTestResult(result);
        if (result.ok) {
          setTimeout(() => {
            onConnected?.();
            handleClose();
          }, 1500);
        }
      } else {
        setTestResult({ ok: false, message: "Failed to test connection" });
      }
    } catch {
      setTestResult({ ok: false, message: "Network error" });
    } finally {
      setTesting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setServiceAccountKey(reader.result as string);
    };
    reader.readAsText(file);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm" onClick={handleClose}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-lg sm:mx-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="px-6 py-5 border-b ghost-border flex items-center justify-between sticky top-0 bg-white rounded-t-3xl z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${config.color}15` }}>
              {config.icon}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-on-surface">Connect {config.label}</h2>
              <p className="text-xs text-on-surface-variant">Enter your database credentials</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-2 rounded-xl hover:bg-surface-variant/30 transition-colors">
            <X className="w-5 h-5 text-on-surface-variant" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <AnimatePresence mode="wait">
            {testResult?.ok ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center py-6"
              >
                <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-lg font-semibold text-on-surface mb-1">Connected!</h3>
                <p className="text-sm text-on-surface-variant text-center">
                  {config.label} connection verified
                  {testResult.latencyMs && <span className="text-xs"> ({testResult.latencyMs}ms)</span>}
                </p>
                {testResult.tableCount != null && (
                  <div className="mt-4 w-full bg-surface-variant/20 rounded-xl p-4 border ghost-border">
                    <div className="flex items-center gap-2 mb-2">
                      <Database className="w-4 h-4 text-on-surface-variant" />
                      <span className="text-xs font-medium text-on-surface">{testResult.tableCount} tables detected</span>
                    </div>
                    {testResult.sampleTables && testResult.sampleTables.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {testResult.sampleTables.slice(0, 8).map((t) => (
                          <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-primary-container/10 text-primary-m3 border border-primary-container/20">{t}</span>
                        ))}
                        {testResult.sampleTables.length > 8 && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-variant/30 text-on-surface-variant">+{testResult.sampleTables.length - 8} more</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Label (optional)</label>
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={`e.g. Production ${config.label}`}
                    className="w-full px-4 py-2.5 rounded-xl bg-surface-variant/20 border ghost-border text-sm outline-none focus:ring-2 ring-primary-m3/30"
                  />
                </div>

                {!isBigQuery && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Host *</label>
                      <input
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                        placeholder="db.example.com"
                        className="w-full px-4 py-2.5 rounded-xl bg-surface-variant/20 border ghost-border text-sm outline-none focus:ring-2 ring-primary-m3/30"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Port *</label>
                      <input
                        value={port}
                        onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
                        placeholder={String(config.defaultPort)}
                        className="w-full px-4 py-2.5 rounded-xl bg-surface-variant/20 border ghost-border text-sm outline-none focus:ring-2 ring-primary-m3/30"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
                    {isBigQuery ? "Project ID *" : "Database Name *"}
                  </label>
                  <input
                    value={databaseName}
                    onChange={(e) => setDatabaseName(e.target.value)}
                    placeholder={isBigQuery ? "my-gcp-project" : "my_database"}
                    className="w-full px-4 py-2.5 rounded-xl bg-surface-variant/20 border ghost-border text-sm outline-none focus:ring-2 ring-primary-m3/30"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Username *</label>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={isBigQuery ? "service-account@project.iam.gserviceaccount.com" : "db_user"}
                    className="w-full px-4 py-2.5 rounded-xl bg-surface-variant/20 border ghost-border text-sm outline-none focus:ring-2 ring-primary-m3/30"
                  />
                </div>

                {isBigQuery ? (
                  <div>
                    <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Service Account Key (JSON) *</label>
                    <div className="border-2 border-dashed ghost-border rounded-xl p-4 text-center cursor-pointer hover:border-primary-m3/30 transition-colors">
                      <input
                        type="file"
                        accept=".json"
                        onChange={handleFileUpload}
                        className="hidden"
                        id="sa-key-upload"
                      />
                      <label htmlFor="sa-key-upload" className="cursor-pointer">
                        {serviceAccountKey ? (
                          <div className="flex items-center justify-center gap-2 text-sm text-green-700">
                            <CheckCircle2 className="w-4 h-4" />
                            Key file loaded
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-2">
                            <Upload className="w-6 h-6 text-on-surface-variant/50" />
                            <span className="text-xs text-on-surface-variant">Drop JSON key file or click to browse</span>
                          </div>
                        )}
                      </label>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Password *</label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter password"
                        className="w-full px-4 py-2.5 pr-12 rounded-xl bg-surface-variant/20 border ghost-border text-sm outline-none focus:ring-2 ring-primary-m3/30"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-surface-variant/30"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4 text-on-surface-variant" /> : <Eye className="w-4 h-4 text-on-surface-variant" />}
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="flex items-start gap-2 text-xs text-error bg-error-container/10 px-3 py-2.5 rounded-xl">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {testResult && !testResult.ok && (
                  <div className="flex items-start gap-2 text-xs text-error bg-error-container/10 px-3 py-2.5 rounded-xl">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{testResult.message}</span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {!testResult?.ok && (
          <div className="px-6 py-4 border-t ghost-border flex justify-end gap-3 sticky bottom-0 bg-white rounded-b-3xl">
            <button
              onClick={handleClose}
              className="px-5 py-2.5 text-sm rounded-3xl ghost-border hover:bg-surface-variant/30 transition-colors text-on-surface-variant"
            >
              Cancel
            </button>
            {savedId ? (
              <button
                onClick={handleTest}
                disabled={testing}
                className="px-5 py-2.5 text-sm rounded-3xl text-white font-medium hover:opacity-90 transition-colors disabled:opacity-60 flex items-center gap-2"
                style={{ backgroundColor: config.color }}
              >
                {testing && <Loader2 className="w-4 h-4 animate-spin" />}
                {testing ? "Testing..." : "Test & Preview"}
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 text-sm rounded-3xl bg-primary-m3 text-white font-medium hover:bg-primary-m3/90 transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? "Saving..." : "Save & Continue"}
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
