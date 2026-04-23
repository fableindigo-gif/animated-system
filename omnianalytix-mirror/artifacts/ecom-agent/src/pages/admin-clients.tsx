import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-fetch";
import { queryKeys } from "@/lib/query-keys";
import { QueryErrorState } from "@/components/query-error-state";
import { cn } from "@/lib/utils";
import { Plus, Building2, Users, Cable, Loader2, Search, ChevronRight, Check } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface OrgRow {
  id: number;
  name: string;
  slug: string;
  subscriptionTier: string | null;
  createdAt: string;
  memberCount: number;
  connectionCount: number;
  workspaceCount: number;
}

type CreateOrgForm = {
  name: string;
  slug: string;
  adminEmail: string;
  goal: "ecom" | "leadgen" | "hybrid";
};

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const slugify = (raw: string) =>
  raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export default function AdminClientsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [created, setCreated] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting, touchedFields },
  } = useForm<CreateOrgForm>({
    mode: "onBlur",
    defaultValues: { name: "", slug: "", adminEmail: "", goal: "ecom" },
  });

  // Auto-derive the slug from the org name until the user manually edits the
  // slug field, mirroring the previous handleSlugify behavior.
  const watchedName = watch("name");
  useEffect(() => {
    if (touchedFields.slug) return;
    setValue("slug", slugify(watchedName ?? ""), { shouldValidate: false });
  }, [watchedName, touchedFields.slug, setValue]);

  const orgsQuery = useQuery({
    queryKey: queryKeys.adminOrganizations(),
    queryFn: async () => {
      const res = await authFetch(`${BASE}/api/admin/organizations`);
      if (!res.ok) throw new Error(`Could not load organizations (HTTP ${res.status}).`);
      return (await res.json()) as OrgRow[];
    },
  });
  const orgs = orgsQuery.data ?? [];
  const loading = orgsQuery.isLoading;
  const loadError = orgsQuery.isError ? (orgsQuery.error as Error)?.message ?? "Failed to load organizations." : null;

  const createMutation = useMutation({
    mutationFn: async (payload: CreateOrgForm) => {
      const res = await authFetch(`${BASE}/api/admin/organizations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to create organization");
      }
      return res.json();
    },
    onSuccess: () => {
      setCreated(true);
      setSubmitError("");
      queryClient.invalidateQueries({ queryKey: queryKeys.adminOrganizations() });
      setTimeout(() => {
        setShowCreate(false);
        setCreated(false);
        reset({ name: "", slug: "", adminEmail: "", goal: "ecom" });
      }, 1500);
    },
    onError: (e) => {
      setSubmitError(e instanceof Error ? e.message : "Failed to create");
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError("");
    await createMutation.mutateAsync({
      ...values,
      name: values.name.trim(),
      slug: values.slug.trim(),
      adminEmail: values.adminEmail.trim(),
    });
  });

  const submitting = isSubmitting || createMutation.isPending;

  const filtered = orgs.filter((o) =>
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    o.slug.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between gap-6 mb-8">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-on-surface">Client Accounts</h1>
          <p className="text-sm text-on-surface-variant mt-1">Each entry is a top-level account — with its own isolated workspace, team, and billing. Use the sidebar workspace switcher to add campaign workspaces within your current account.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="shrink-0 whitespace-nowrap inline-flex items-center gap-2 px-5 py-2.5 bg-primary-container text-white rounded-xl text-sm font-bold hover:bg-primary-m3 transition-all active:scale-[0.97] shadow-sm"
        >
          <Plus className="w-4 h-4" aria-hidden="true" /> New Client
        </button>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" aria-hidden="true" />
        <label htmlFor="admin-clients-search" className="sr-only">Search organizations</label>
        <input
          id="admin-clients-search"
          type="text"
          placeholder="Search organizations..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-outline-variant/15 rounded-xl text-sm bg-white focus:ring-2 focus:ring-primary-container/20 focus:border-primary-container/30 outline-none transition-all"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-on-surface-variant" aria-hidden="true" />
        </div>
      ) : loadError ? (
        <QueryErrorState
          title="Couldn't load organizations"
          error={loadError}
          onRetry={() => orgsQuery.refetch()}
        />
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Building2 className="w-12 h-12 mx-auto text-surface-container-highest mb-4" aria-hidden="true" />
          <p className="text-on-surface-variant font-medium">{search ? "No matching organizations" : "No client organizations yet"}</p>
          <p className="text-sm text-on-surface-variant mt-1">Click "New Client" to provision one after closing a deal.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((org) => (
            <div key={org.id} className="bg-white border border-outline-variant/15 rounded-2xl p-5 hover:shadow-md transition-all group">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-primary-container/10 flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-primary-container" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-on-surface">{org.name}</h3>
                    <p className="text-xs text-on-surface-variant mt-0.5 font-mono">{org.slug}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-4 text-xs text-on-surface-variant">
                    <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" aria-hidden="true" />{org.memberCount} members</span>
                    <span className="flex items-center gap-1.5"><Cable className="w-3.5 h-3.5" aria-hidden="true" />{org.connectionCount} connections</span>
                  </div>
                  <span className={cn(
                    "text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider",
                    org.subscriptionTier === "pro" ? "bg-emerald-50 text-emerald-700" : org.subscriptionTier === "demo" ? "bg-amber-50 text-amber-700" : "bg-surface-container-low text-on-surface-variant",
                  )}>
                    {org.subscriptionTier || "free"}
                  </span>
                  <ChevronRight className="w-4 h-4 text-on-surface-variant group-hover:text-primary-container transition-colors" aria-hidden="true" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="provision-org-title"
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center sm:p-4"
          onClick={() => !submitting && setShowCreate(false)}
        >
          <form
            onSubmit={onSubmit}
            noValidate
            className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md overflow-hidden sm:mx-auto max-h-[92dvh] sm:max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-6 pb-4 border-b ghost-border">
              <h2 id="provision-org-title" className="text-lg font-bold text-on-surface">Provision New Client</h2>
              <p className="text-sm text-on-surface-variant mt-1">Set up an organization for a new client after closing the deal.</p>
            </div>
            <fieldset disabled={submitting} className="p-6 space-y-4 disabled:opacity-90">
              <div>
                <label htmlFor="org-name" className="block text-xs font-bold text-on-surface-variant mb-1.5">Organization Name</label>
                <input
                  id="org-name"
                  type="text"
                  placeholder="Acme Growth Agency"
                  aria-invalid={errors.name ? "true" : "false"}
                  aria-describedby={errors.name ? "org-name-error" : undefined}
                  className="w-full px-4 py-2.5 border border-outline-variant/15 rounded-xl text-sm focus:ring-2 focus:ring-primary-container/20 focus:border-primary-container/30 outline-none disabled:bg-surface-container-low"
                  {...register("name", {
                    required: "Organization name is required.",
                    minLength: { value: 2, message: "Name must be at least 2 characters." },
                    maxLength: { value: 80, message: "Name must be 80 characters or fewer." },
                  })}
                />
                {errors.name && (
                  <p id="org-name-error" role="alert" className="mt-1 text-xs text-error-m3 font-medium">{errors.name.message}</p>
                )}
              </div>
              <div>
                <label htmlFor="org-slug" className="block text-xs font-bold text-on-surface-variant mb-1.5">Slug</label>
                <input
                  id="org-slug"
                  type="text"
                  placeholder="acme-growth"
                  aria-invalid={errors.slug ? "true" : "false"}
                  aria-describedby={errors.slug ? "org-slug-error" : "org-slug-hint"}
                  className="w-full px-4 py-2.5 border border-outline-variant/15 rounded-xl text-sm font-mono focus:ring-2 focus:ring-primary-container/20 focus:border-primary-container/30 outline-none disabled:bg-surface-container-low"
                  {...register("slug", {
                    required: "Slug is required.",
                    pattern: { value: SLUG_PATTERN, message: "Use lowercase letters, numbers, and dashes only." },
                    maxLength: { value: 60, message: "Slug must be 60 characters or fewer." },
                    setValueAs: (v: string) => (v ?? "").toLowerCase().replace(/[^a-z0-9-]/g, ""),
                  })}
                />
                {errors.slug ? (
                  <p id="org-slug-error" role="alert" className="mt-1 text-xs text-error-m3 font-medium">{errors.slug.message}</p>
                ) : (
                  <p id="org-slug-hint" className="mt-1 text-[11px] text-on-surface-variant">Auto-generated from the name. Edit if you need a custom URL.</p>
                )}
              </div>
              <div>
                <label htmlFor="org-admin-email" className="block text-xs font-bold text-on-surface-variant mb-1.5">Client Admin Email (optional)</label>
                <input
                  id="org-admin-email"
                  type="email"
                  placeholder="admin@acme.com"
                  aria-invalid={errors.adminEmail ? "true" : "false"}
                  aria-describedby={errors.adminEmail ? "org-admin-email-error" : undefined}
                  className="w-full px-4 py-2.5 border border-outline-variant/15 rounded-xl text-sm focus:ring-2 focus:ring-primary-container/20 focus:border-primary-container/30 outline-none disabled:bg-surface-container-low"
                  {...register("adminEmail", {
                    validate: (v) => !v || EMAIL_PATTERN.test(v.trim()) || "Enter a valid email address.",
                  })}
                />
                {errors.adminEmail && (
                  <p id="org-admin-email-error" role="alert" className="mt-1 text-xs text-error-m3 font-medium">{errors.adminEmail.message}</p>
                )}
              </div>
              <div>
                <span className="block text-xs font-bold text-on-surface-variant mb-1.5">Primary Goal</span>
                <Controller
                  control={control}
                  name="goal"
                  render={({ field }) => (
                    <div role="radiogroup" aria-label="Primary goal" className="grid grid-cols-3 gap-2">
                      {(["ecom", "leadgen", "hybrid"] as const).map((g) => {
                        const selected = field.value === g;
                        return (
                          <button
                            key={g}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => field.onChange(g)}
                            className={cn(
                              "py-2.5 rounded-xl text-xs font-bold border-2 transition-all",
                              selected
                                ? "border-primary-container bg-primary-container/10 text-primary-container"
                                : "border-outline-variant/15 text-on-surface-variant hover:border-outline-variant/30",
                            )}
                          >
                            {g === "ecom" ? "E-Commerce" : g === "leadgen" ? "Lead Gen" : "Hybrid"}
                          </button>
                        );
                      })}
                    </div>
                  )}
                />
              </div>
              {submitError && (
                <p role="alert" className="text-sm text-error-m3 font-medium">{submitError}</p>
              )}
            </fieldset>
            <div className="px-6 pb-6 flex gap-3">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                disabled={submitting}
                className="flex-1 py-2.5 border border-outline-variant/15 rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface transition-all disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || created}
                className={cn(
                  "flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                  created
                    ? "bg-emerald-500 text-white"
                    : "bg-primary-container text-white hover:bg-primary-m3 active:scale-[0.98]",
                  (submitting || created) && "opacity-90",
                )}
              >
                {created ? (
                  <><Check className="w-4 h-4" aria-hidden="true" /> Created!</>
                ) : submitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Creating...</>
                ) : (
                  "Create Organization"
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
