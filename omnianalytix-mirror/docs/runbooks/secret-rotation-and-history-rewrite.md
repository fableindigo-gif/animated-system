# Runbook: Rotate Leaked Secrets & Rewrite Git History

**Status:** OPEN — destructive cleanup pending.
**Created:** April 17, 2026
**Owner:** Repo administrator (must have GCP, Shopify, Google Ads console access + force-push rights on the remote).

This runbook supersedes Task #3. The Replit Agent could not execute it because:
- Agent is forbidden from running raw git commands or force-pushing.
- Agent has no access to upstream provider consoles (GCP, Shopify, Google Ads).
- `git filter-repo` is not installed in the Replit container.

You must run these steps yourself on a machine with full repo-admin and provider-admin access. Do **not** skip the order — credential rotation happens **before** the history rewrite so leaked values are already dead by the time the old commits become unreachable.

---

## 0. Prerequisites

On your local machine:

```bash
# Install git-filter-repo (preferred over BFG)
pip install git-filter-repo
# or: brew install git-filter-repo

# Verify
git filter-repo --version
```

You will need:
- Owner/Editor on the GCP project that issued the service-account key.
- Admin on the Google Cloud OAuth consent screen / Credentials page.
- Admin on the Shopify Partner / store admin (for shared secret).
- Admin on the Google Ads MCC (for developer token).
- Replit workspace access to update Secrets.
- Force-push rights on the git remote.

---

## 1. Inventory the exposed values

The three deleted files under `attached_assets/` are believed to have contained:

| # | Provider              | Secret type                          | Search marker (for grep)            |
|---|-----------------------|--------------------------------------|-------------------------------------|
| 1 | App (Express session) | `SESSION_SECRET`                     | `SESSION_SECRET=CUU8tSR`            |
| 2 | Google Cloud IAM      | Service account JSON private key     | `BEGIN PRIVATE KEY`                 |
| 3 | Google OAuth 2.0      | OAuth client secret                  | `GOCSPX-`                           |
| 4 | Shopify               | App shared secret / Admin API token  | `shpss_`, `shpat_`                  |
| 5 | Google Ads            | Developer token                      | (alphanumeric, ~22 chars)           |
| 6 | GCP IAM (project #2)  | Second SA private key (added §1b)    | `omnianalytix-vertex@rehab-ba713`   |
| 7 | Unknown               | `*E_SERVICE_KEY` env value (§1b)     | `E_SERVICE_KEY":`                   |

Confirm the full list with a fresh **mirror clone** (do not work in your existing checkout):

```bash
git clone --mirror <remote-url> repo-audit.git
cd repo-audit.git

git log --all -- attached_assets/                    # commits that touched the dir
git log -p --all -S 'BEGIN PRIVATE KEY'              # GCP key
git log -p --all -S 'GOCSPX-'                        # Google OAuth secret
git log -p --all -S 'SESSION_SECRET=CUU8tSR'         # Session secret
git log -p --all -S 'shpss_'                         # Shopify shared secret
git log -p --all -S 'shpat_'                         # Shopify admin token
git log -p --all -S 'omnianalytix-vertex@rehab-ba713' # 2nd GCP SA (added §1b)
git log -p --all -S 'E_SERVICE_KEY":'                # unknown service-key env var (added §1b)
```

For each match, copy the literal value into a local **scratch file** (never commit it) so step 2 has a precise revoke list.

---

## 1b. Full-history secret sweep (do this BEFORE step 2)

The five values in §1 are the *known* leaks. Other credentials may have been committed elsewhere over the project's life (older commits, deleted branches, `.env*` files that briefly held real values, vendored fixtures, build artifacts, etc.). Run a broad scanner against the same mirror clone so the rotation list in §2 is complete before you start revoking — otherwise you will discover a new leak after the force-push and have to repeat the whole destructive operation.

> **Audit completed in the Replit workspace on April 17, 2026.** Both gitleaks v8.21.2 and trufflehog v3.84.2 were run against the in-workspace `.git` (full history, all refs reachable from this checkout). **Sanitized** reports are committed under `docs/runbooks/audit/` — every `Raw` / `RawV2` / `Secret` field and any string containing a PEM block is replaced with `[REDACTED sha256:<fp> len:<n>]` so the reports are safe to keep in tracked history. The original unredacted scanner output never left `/tmp` and was overwritten before commit. The reports retain only commit/file/line metadata, detector name, verification status, and the trufflehog-provided `Redacted` field (which holds public identifiers like SA email).
> - `2026-04-17-gitleaks.json` — 14 findings.
> - `2026-04-17-trufflehog-all.json` — 4 findings.
> - `2026-04-17-trufflehog-verified.json` — **3 findings VERIFIED LIVE by Google's API**.
> - `2026-04-17-mirror-gitleaks.json` — gitleaks re-run against a `git clone --mirror file:///home/runner/workspace/.git` of the workspace repo (135 commits across **all 5 local branches** — `main`, `main-repl/main`, `replit-agent`, `subrepl-83qip54p`, `subrepl-fy70ft31` — plus `refs/replit/agent-ledger` and `refs/remotes/origin/main`). Result: 26 findings = the 14 original + **12 false-positives self-introduced by this very task** in earlier (pre-sanitization) versions of the audit JSON files committed at `f3b450d2` and `0b60c7b3`. Those false-positives match only the literal string `-----BEGIN PRIVATE KEY-----` plus 27 base64 chars of the DER algorithm-OID header (no key material) — but the §3 `--replace-text` step below scrubs the marker anyway so the `git log -S 'BEGIN PRIVATE KEY'` verification gate returns zero post-rewrite.
>
> **Operator must still re-run on a fresh mirror clone OF THE REMOTE** — agent could not authenticate to `https://github.com/ableysindia-sys/Omniscient-Commerce-Agent.git` (token-only auth required for HTTPS). The remote may carry deleted refs the workspace `.git` cannot see. Use the §1b.2 commands against the remote mirror and diff against the four committed reports above; any *new* finding is a Bucket-C item that must be added to §2 before §3 force-pushes.
>
> **Triage result: every finding is confined to `attached_assets/Pasted-*` files inside three commits (`10e6edc5`, `2790d9d6`, `3153c8e3`)** — exactly the directory the §3 filter-repo command will remove. No new secret was found outside that scope. Per-finding triage:
>
> | # | Source / commit | File | Detector | Bucket | Disposition |
> |---|---|---|---|---|---|
> | 1 | gitleaks 10e6edc5 | `attached_assets/Pasted--type-service-account...txt` | private-key | C | §2a (existing — `vertex-ai-user@omnismtp` SA) |
> | 2 | gitleaks 10e6edc5 | same | generic-api-key (`private_key_id`) | C | rotates with §2a |
> | 3 | trufflehog 10e6edc5 VERIFIED | same | GCP / PrivateKey | C | §2a |
> | 4-6 | gitleaks 2790d9d6 | `attached_assets/Pasted--SESSION-SECRET-...036621.txt` | private-key + 2× shopify-shared-secret | C | §2a.bis + §2c |
> | 7-9 | gitleaks 2790d9d6 | same | 3× generic-api-key (DS_CLIENT_SECRET tail, DEVELOPER_TOKEN tail, *E_SERVICE_KEY tail) | C | §2b + §2d + §2f |
> | 10 | trufflehog 2790d9d6 VERIFIED | same | GCP (omnianalytix-vertex@rehab-ba713) | C | §2a.bis |
> | 11-16 | gitleaks 3153c8e3 | `attached_assets/Pasted--SESSION-SECRET-...100298.txt` | mirror of 4-9 above (same content, second copy) | C | covered by §2a.bis / §2b / §2c / §2d / §2f |
> | 17 | trufflehog 3153c8e3 VERIFIED | same | GCP (omnianalytix-vertex@rehab-ba713) | C | §2a.bis (already counted) |
> | 18 | trufflehog 2790d9d6 unverified | same | PrivateKey (the second SA's key body) | C | §2a.bis (already counted) |
> | 19-30 | mirror gitleaks f3b450d2 / 0b60c7b3 | `docs/runbooks/audit/2026-04-17-trufflehog-{all,verified}.json` | private-key | A (false positive) | PEM-marker text only, no key body; the `--replace-text` step in §3 scrubs the marker anyway |
>
> **Three new facts the original §1 inventory missed are now reflected in the rotation list below:**
>
> 1. **Second GCP service account leaked.** Trufflehog VERIFIED two distinct SAs are still live:
>    - `vertex-ai-user@omnismtp.iam.gserviceaccount.com` (commit `10e6edc5`) — already covered by §2a.
>    - `omnianalytix-vertex@rehab-ba713.iam.gserviceaccount.com` (commits `2790d9d6`, `3153c8e3`) — **NEW**, see §2a.bis below.
> 2. **OAuth client-secret env var name.** The leaked env file used `GOOGLE_ADS_CLIENT_SECRET` (the application code in `artifacts/api-server/src/routes/auth/{gate,google-oauth}.ts` and `lib/google-token-refresh.ts` confirms this is the only OAuth-secret variable in use). §2b has been updated.
> 3. **Unidentified `*E_SERVICE_KEY` env var.** Gitleaks redacted a secret behind an env-var name whose tail is `E_SERVICE_KEY` (likely `BASE64_SERVICE_KEY` or similar — does not appear in the current working tree). The operator must open the leaked file from history, identify the full var name, and rotate the underlying credential — see §2f below.
>
> The history-only scanner re-run on the operator's mirror clone is still listed below as a belt-and-braces check before §3, but it should produce no new findings beyond the three above.

### 1b.1 Install scanners

```bash
# gitleaks — fast, low false-positive rate, scans full history.
brew install gitleaks                       # or: see https://github.com/gitleaks/gitleaks releases

# trufflehog — complementary; verifies many findings against the live provider API.
brew install trufflehog                     # or: pipx install trufflehog
```

### 1b.2 Run both scanners against the mirror clone

```bash
cd repo-audit.git   # the --mirror clone from §1

# gitleaks: scan every commit on every ref.
gitleaks detect \
  --source . \
  --log-opts="--all" \
  --redact \
  --report-format json \
  --report-path ../gitleaks-report.json

# trufflehog: scan full git history with verification enabled
# (verification hits the provider API to confirm a secret is still live —
# only run from a workstation you trust to make those outbound calls).
trufflehog git file://. \
  --json \
  --no-update \
  --only-verified > ../trufflehog-verified.json

# Also run trufflehog WITHOUT --only-verified to see unverified candidates
# that providers may not have a verifier for (e.g. SESSION_SECRET, generic JWTs).
trufflehog git file://. \
  --json \
  --no-update > ../trufflehog-all.json
```

### 1b.3 Backstop with `git log -S` for high-signal markers

`gitleaks` and `trufflehog` cover most provider patterns, but run these greps too — they catch values the scanners' rule-packs may miss:

```bash
# Cloud + AI providers
git log -p --all -S 'AKIA'                          # AWS access key
git log -p --all -S 'aws_secret_access_key'
git log -p --all -S 'AIza'                          # Google API key
git log -p --all -S 'ya29.'                         # Google OAuth access token
git log -p --all -S 'sk-'                           # OpenAI / Anthropic style
git log -p --all -S 'sk_live_'                      # Stripe live secret
git log -p --all -S 'sk_test_'                      # Stripe test secret
git log -p --all -S 'rk_live_'                      # Stripe restricted key

# VCS / messaging / CI tokens
git log -p --all -S 'ghp_' ; git log -p --all -S 'github_pat_'
git log -p --all -S 'gho_' ; git log -p --all -S 'ghs_'
git log -p --all -S 'glpat-'                        # GitLab PAT
git log -p --all -S 'xoxb-' ; git log -p --all -S 'xoxp-'
git log -p --all -S 'SG.'                           # SendGrid

# Generic high-value markers
git log -p --all -S 'BEGIN PRIVATE KEY'
git log -p --all -S 'BEGIN RSA PRIVATE KEY'
git log -p --all -S 'BEGIN OPENSSH PRIVATE KEY'
git log -p --all -S 'BEGIN PGP PRIVATE KEY'

# Connection strings with embedded credentials
git log -p --all --pickaxe-regex -S 'postgres(ql)?://[^[:space:]]+:[^@[:space:]]+@'
git log -p --all --pickaxe-regex -S 'mongodb(\+srv)?://[^[:space:]]+:[^@[:space:]]+@'
git log -p --all --pickaxe-regex -S 'redis://[^@[:space:]]*:[^@[:space:]]+@'

# .env files anywhere in history (any branch, any commit) — even if currently gitignored
git log --all --diff-filter=A --name-only --pretty=format: \
  | sort -u | grep -E '(^|/)\.env(\..+)?$' || echo 'no .env files ever committed'
```

### 1b.4 Triage every finding

For each match from gitleaks / trufflehog / the greps, classify into one of three buckets and record in the rotation table you'll build below:

| Bucket | Definition | Action |
|---|---|---|
| **A. False positive** | Test fixture, sample, placeholder, sanitizer regex, env-var name reference (e.g. `shpat_test_key_abc123`, `process.env.GOOGLE_CLIENT_SECRET`, `/^shpat_/i`). | Note it in the report and skip. |
| **B. Already rotated** | Value matches one of the five inventoried in §1, OR you can confirm with the provider that the credential has already been revoked. | Skip rotation; still gets removed by §3 history rewrite. |
| **C. Live secret needing rotation** | Anything else — including unknown values, expired-looking tokens you cannot confirm dead, and anything `trufflehog --only-verified` flagged. Treat as live. | **Add a new subsection 2f, 2g, … below**, mirroring the format of §2a–2e (rotate → update Replit Secret → restart → smoke test → revoke). |

### 1b.5 Gate the force-push

Do **not** proceed to §3 until:

- [ ] Both scanners have completed against the mirror clone with zero unhandled findings.
- [ ] Every Bucket-C finding has a corresponding new subsection under §2 and that subsection's rotation + revoke steps are checked off.
- [ ] The §1 `git log -S` table is extended with one row per Bucket-C marker so §3's verification greps will catch any regression.

---

## 2. Rotate at the upstream providers

**Order matters: regenerate first, then update Replit Secrets, then revoke the old credential.** That keeps the API server live during the swap.

### 2a. GCP service-account private key
1. GCP Console → IAM & Admin → Service Accounts → pick the SA → **Keys** → *Add Key → Create new key (JSON)*. Download.
2. In Replit → Secrets, replace `GOOGLE_APPLICATION_CREDENTIALS_JSON` (or whatever the API server reads) with the new JSON contents.
3. Restart the `artifacts/api-server: API Server` workflow.
4. Smoke test: open the app, run a Vertex AI / Sheets / Drive call (e.g. send a chat message in OmniCopilot).
5. Back in GCP → SA → Keys → **delete** the old key (identified by its key ID, visible in the leaked JSON as `private_key_id`).

### 2a.bis. Second GCP service-account private key (added by §1b audit, April 17, 2026)
A second SA key was VERIFIED LIVE by trufflehog in commits `2790d9d6` and `3153c8e3`:
- Service account: `omnianalytix-vertex@rehab-ba713.iam.gserviceaccount.com`
- Project: `rehab-ba713`

Apply the same procedure as §2a against **that** SA in **that** GCP project. Confirm with the project owner whether this SA is still in use anywhere (it may have been a short-lived experiment in a different GCP project) — if not in use, **delete the entire service account**, not just the key, after rotating any consumer that depends on it.

### 2b. Google OAuth client secret
1. GCP Console → APIs & Services → Credentials → OAuth 2.0 Client ID for the web app → **Reset secret**.
2. Replit Secrets: update `GOOGLE_ADS_CLIENT_SECRET` (this is the env var the app actually reads — see `artifacts/api-server/src/routes/auth/{gate,google-oauth}.ts` and `artifacts/api-server/src/lib/google-token-refresh.ts`). Update any per-platform variants the OAuth routes also read.
3. Restart the API server.
4. Smoke test: sign out, sign back in via Google SSO; complete a Google Workspace OAuth connect from the Connections page.
5. The reset action automatically invalidates the previous secret — no separate revoke step.

### 2c. Shopify shared secret / admin token
1. Shopify Partner Dashboard → your app → **API credentials** → *Rotate API secret key*.
2. If a store-specific Admin API access token leaked, also: store admin → Apps → your app → *Uninstall and reinstall* (or rotate the token from Custom App settings).
3. Replit Secrets: update `SHOPIFY_API_SECRET` and any `SHOPIFY_ADMIN_TOKEN_*`.
4. Restart the API server. Smoke test: trigger a Shopify ETL sync from the Connections page; confirm warehouse rows update.

### 2d. Google Ads developer token
1. Google Ads → Tools → API Center → request a new developer token (or rotate if available). Note: Google Ads dev tokens cannot be self-rotated freely — open a support ticket via API Center if needed.
2. Replit Secrets: update `GOOGLE_ADS_DEVELOPER_TOKEN`.
3. Restart, smoke test a Google Ads pull.
4. Once new token is approved & live, request revocation of the old token through Google Ads support.

### 2e. Express session secret
1. Generate a new value: `openssl rand -hex 48`.
2. Replit Secrets: update `SESSION_SECRET`.
3. Restart the API server. **All existing sessions will be invalidated** — users must sign back in. This is expected and acceptable.

### 2f. Unidentified `*E_SERVICE_KEY` value (added by §1b audit, April 17, 2026)
Gitleaks flagged a generic-api-key match in commits `2790d9d6` and `3153c8e3` whose env-var name's tail is `E_SERVICE_KEY` (the leading characters were truncated by gitleaks' fixed Match window, and the variable does not appear anywhere in the current working tree). Likely candidates given the surrounding context: `BASE64_SERVICE_KEY`, `BIGQUERY_SERVICE_KEY`, `FIREBASE_SERVICE_KEY`, or `<projectname>_SERVICE_KEY`.

1. Open the offending file from the mirror clone to read the full env-var name and value:
   ```bash
   cd repo-audit.git
   git show 2790d9d6:attached_assets/Pasted--SESSION-SECRET-CUU8tSR32qaz76CHpiv4trRXw4VkGDLTGCjTo9P_1776116036621.txt | less
   ```
2. Identify which provider issued the value (likely a base64-encoded GCP SA JSON for the second project — if so, this rotates together with §2a.bis and no separate provider action is needed; if it points at a different system, treat it as a fresh Bucket-C finding and rotate at that provider).
3. Update the corresponding Replit Secret, restart the API server, smoke-test any feature that consumes it.
4. Revoke the old value at the provider.

After all rotations (now seven discrete credentials: §2a, §2a.bis, §2b, §2c, §2d, §2e, §2f), run an end-to-end check:
- Sign in fresh.
- Connect one OAuth platform.
- Send a chat message that invokes a tool call.
- Open the dashboard and confirm warehouse data renders.

---

## 3. Rewrite git history

**Do this in the mirror clone from step 1, not your working checkout.**

```bash
cd repo-audit.git

# Strip the entire attached_assets/ directory from every commit on every branch and tag.
git filter-repo --path attached_assets/ --invert-paths --force

# Belt-and-braces: scrub the literal PEM headers and known-leaked OAuth/Shopify markers
# from anywhere they might still appear (e.g. intermediate audit JSON commits made
# during Task #5 that contain "-----BEGIN PRIVATE KEY-----" as a string match,
# or any future docs that quote a leaked literal). Create replacements.txt:
cat > ../replacements.txt <<'EOF'
-----BEGIN PRIVATE KEY-----==>[REDACTED-PEM]
-----BEGIN RSA PRIVATE KEY-----==>[REDACTED-PEM]
-----BEGIN OPENSSH PRIVATE KEY-----==>[REDACTED-PEM]
GOCSPX-==>[REDACTED-OAUTH-CLIENT-SECRET]
shpss_==>[REDACTED-SHOPIFY-SHARED-SECRET]
shpat_==>[REDACTED-SHOPIFY-ADMIN-TOKEN]
SESSION_SECRET=CUU8tSR==>[REDACTED-SESSION-SECRET]
EOF
git filter-repo --replace-text ../replacements.txt --force

# Verify the directory is gone from history.
git log --all -- attached_assets/                    # should print nothing
git log -p --all -S 'BEGIN PRIVATE KEY'              # empty
git log -p --all -S 'GOCSPX-'                        # empty
git log -p --all -S 'SESSION_SECRET=CUU8tSR'         # empty
git log -p --all -S 'shpss_'                         # empty
git log -p --all -S 'shpat_'                         # empty
git log -p --all -S 'omnianalytix-vertex@rehab-ba713' # empty (added §1b)
git log -p --all -S 'E_SERVICE_KEY":'                # empty (added §1b)

# Capture the new root commit SHA — you'll cite it in replit.md.
git log --reverse --format='%H' | head -1
```

If any of the `-S` greps still return matches, the secret is in a file *outside* `attached_assets/`. Rerun filter-repo with an additional `--replace-text replacements.txt` pass where each line is `LITERAL_SECRET==>REDACTED`.

---

## 4. Force-push the rewritten history

```bash
# Re-add the original remote (filter-repo strips it as a safety measure).
git remote add origin <remote-url>

# Push every branch and tag, overwriting the remote.
git push --force --all origin
git push --force --tags origin
```

If the remote rejects force-push because of branch protection on `main`, temporarily disable it for the push, then re-enable.

---

## 5. Coordinate with collaborators

Every existing local clone is now divergent and **cannot be reconciled by a normal pull**. Collaborators must:

1. Save any uncommitted local work as a patch: `git diff > my-wip.patch`.
2. `cd ..` and delete the old clone directory entirely.
3. `git clone <remote-url>` fresh.
4. Re-apply local work: `git apply my-wip.patch`.

Send this notice in your team channel **before** the force-push lands, with a one-hour heads-up.

---

## 6. Update `replit.md`

Append a section under "Reliability Program" recording:
- Date of the history rewrite.
- The new root-commit SHA from step 3.
- A line stating that all secrets exposed in `attached_assets/` between commits `<earliest>` and `<latest>` were rotated and revoked at the upstream providers on this date.

This is what makes a future auditor able to confirm the cleanup happened.

---

## 7. Close-out checklist

- [ ] §1b full-history sweep completed — gitleaks + trufflehog reports archived alongside this runbook (e.g. `docs/runbooks/audit/2026-04-17-gitleaks.json`).
- [ ] Every Bucket-C finding from §1b.4 has been rotated AND its marker is included in the §3 verification greps below.
- [ ] All five (plus any added in §1b.4) providers show the old credentials as revoked/deleted.
- [ ] `git log --all -- attached_assets/` on the remote returns nothing.
- [ ] All five (plus §1b.4 additions) `git log -p -S` searches return nothing on the remote.
- [ ] API server boots, sign-in works, at least one OAuth flow + one ETL sync verified end-to-end.
- [ ] `replit.md` updated with rewrite date and new root SHA.
- [ ] Collaborators notified and re-cloned.

Once every box is checked, this runbook can be archived (move to `docs/runbooks/archive/`) but should not be deleted — it's the audit trail.
