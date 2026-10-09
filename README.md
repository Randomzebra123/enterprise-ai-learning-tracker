# Enterprise AI Architect — Cloud Learning Tracker

A deployable static GitHub Pages application with email magic-link sign-in and Supabase PostgreSQL progress storage. Includes all 12 weeks / 60 tasks from the original dashboard, YouTube links, learning hours, evidence, notes, JSON backup/restore, CSV export and print/PDF.

## Files

- `index.html` — user interface and original learning content.
- `cloud-sync.js` — sign-in, cloud reading/writing and conflict handling.
- `config.js` — public Supabase project URL + **publishable key only**.
- `schema.sql` — database table, row-level security and atomic save function.
- `tasks.csv` — original static task reference list.

## Prerequisites

A GitHub account, a free-tier-compatible Supabase project and an email account. Standard GitHub Pages and Supabase free tiers have usage limits and may change. **No server or build tooling required.**

## 1 — Set up Supabase

1. At https://supabase.com/dashboard create a new project, choose a strong database password and a suitable hosting region (e.g. UK/EU according to your preferences).
2. In **SQL Editor**, create a new query, paste the **entire** `schema.sql` file and run it. Verify `public.tracker_progress` is present and RLS is enabled.
3. Under **Authentication > Providers > Email**, enable email authentication. For passwordless links, keep the email link/OTP capability enabled. Email sending limits and SMTP rules may apply to Supabase's built-in email service.
4. Under **Project Settings > API** (menu labels can vary), copy the Project URL and the **publishable key** (`sb_publishable_...`), or the legacy **anon/public** key. **NEVER use a secret/service_role key.**

## 2 — Publish the site on GitHub Pages

1. Create a new repository named `enterprise-ai-learning-tracker` on GitHub.
2. Upload the five files (`index.html`, `cloud-sync.js`, `config.js`, `schema.sql`, `tasks.csv`) to the repository root (or commit them with Git).
3. Edit `config.js` with your Supabase URL and publishable/anon key. These values are **public**; RLS is what protects your data. Do not put other credentials in the file.
4. In **Settings > Pages**, choose **Deploy from a branch**, choose `main` and `/(root)`, then Save.
5. Your site will be at `https://YOUR-USERNAME.github.io/enterprise-ai-learning-tracker/`. If using a free GitHub plan, check your repository's Pages visibility requirements; repository content published through Pages should be treated as public.

## 3 — Configure passwordless authentication redirects

1. In Supabase go to **Authentication > URL Configuration**.
2. Set **Site URL** to `https://YOUR-USERNAME.github.io/enterprise-ai-learning-tracker/`.
3. Add that **exact URL** to **Redirect URLs** as well (include trailing slash). If you use a custom domain, add its HTTPS URL too.
4. In the hosted website enter your email and select **Send sign-in link**. Open the link from your email. You should return to the hosted dashboard and see **Saved to cloud**.
5. Confirm progress sync on a second browser or device using the **same email identity**.

**Security note:** A public sign-in UI doesn't mean a public database. The SQL table has RLS policies matching `auth.uid()` and a save RPC restricted to authenticated users. If you only want your own account, Supabase can restrict new registrations through Auth settings after your account exists; investigate your project's sign-up configuration and test before changing settings. Verify policies in Supabase SQL Editor and test with a second user account if sharing the site.

## 4 — Migrate an existing tracker

### Existing local `.html` (original version)

File-system (`file://`) localStorage is **not** automatically accessible to the new `https://` site.

1. Open your **original** `enterprise_ai_90_day_tracker.html` in the **same browser/profile where you previously recorded progress**.
2. Click **Export progress (.json)** and keep that file safe.
3. Open the hosted cloud tracker and sign in.
4. If your cloud record is empty, choose **Cancel** when asked to upload the hosted browser's current local state (this gives you a blank cloud record).
5. Click **Import progress (.json)** and select the original export.
6. Choose **Sync now**, then verify the status is **Saved to cloud**.
7. Sign in from a different browser and check that task checkboxes, notes and hours appear.

### Previously used the new hosted page without signing in

On the first successful sign-in, when the cloud record does not exist, the application offers to upload that browser's local progress. **Accept** to migrate automatically. If a cloud record already exists and differs from pending local progress, a conflict is shown. Neither copy is silently overwritten.

## 5 — How saving works

- Signed out: progress is saved locally only, in the browser's `localStorage`.
- Signed in: changes are written locally immediately, and then sent to Supabase after a short debounce.
- Offline: the local copy remains. When online again, changes can be retried using **Sync now** (the app also attempts a retry on the `online` event).
- Multi-device conflicts: the database increments a version number for every successful save. A stale browser's save is rejected rather than silently overwriting the newer cloud version. Choose **Load cloud version** or **Overwrite cloud version**, after exporting a JSON backup. There is no automatic per-task merging.
- Signing back in: pending local progress and its baseline version are restored. If the baseline is current, pending edits are retried. If cloud progress is newer, choose a version explicitly. Logout retains pending edits by account.
- The dashboard is NOT a full offline progressive web app: it needs network access to fetch the pinned Supabase JavaScript module and to sign in; it only retains locally saved progress between visits.
- Supabase free projects may pause after inactivity. You may need to reactivate the project in the Supabase dashboard.

## 6 — Basic verification checklist

- [ ] Dashboard loads all 12 weeks and 60 tasks.
- [ ] `config.js` has URL and publishable/anon key (not service key).
- [ ] SQL Editor ran without errors and RLS enabled.
- [ ] Email link redirects to the same GitHub Pages URL.
- [ ] A checkbox change shows **Saved to cloud**.
- [ ] The change survives a browser reload and appears on a second signed-in device.
- [ ] JSON export and import work.
- [ ] Try changing a task on two devices without reloading one: the stale one should show a conflict, **not silently overwrite**.
- [ ] An unrelated signed-in Supabase user cannot select another user's row (test with a separate test account).
- [ ] Never paste `service_role`, secret API tokens or customer data into the site or repository.

## Troubleshooting

- **Setup required:** replace values in `config.js`, commit and let GitHub Pages publish.
- **No email arrives:** inspect Supabase **Authentication > Logs**, spam/junk, sender/rate limits and SMTP configuration.
- **Email link opens incorrect page:** make the Site URL and Redirect URLs match GitHub Pages **exactly** (including folder and trailing slash).
- **Permission denied / function not found:** run `schema.sql` fully and verify grants, exposed `public` schema and RLS policies.
- **Cloud load failed:** check browser console/network; URL/key, provider email settings and connectivity.
- **Pending edits after outage:** select **Sync now**. Export JSON if saving still fails.
- **Conflict:** export JSON first; choose the correct version explicitly.

## Hosting and security limitations

This is a personal learning application, not a regulated enterprise SaaS platform. It uses browser session storage, a hosted JavaScript dependency, the security of Supabase Auth, Postgres RLS and HTTPS. `config.js` is necessarily public. Do not expose database passwords, server tokens, company information or customer files. Pin and periodically review dependencies if extending this project for sensitive use. For enterprise deployment, add automated RLS testing, security reviews, observability, recovery processes and stronger operational controls.

## Documentation

- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- Supabase auth redirects: https://supabase.com/docs/guides/auth/redirect-urls
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase JS authentication: https://supabase.com/docs/reference/javascript/auth-signinwithotp


## Implementation fixes (9 October 2026)

- Preserve pending changes and their baseline version through reload/logout, with per-account and per-tab recovery records.
- Ignore responses from obsolete authenticated sessions; retry failed saves with backoff.
- Explicitly resolve mismatching cloud/local progress; keep local recovery copies before replacing either version.
- Validate backup/cloud shapes, task IDs, notes and hours; reject malformed/oversized JSON. Preserve original v1 export format.
- Block direct client table writes. Only the atomic, identity-scoped save RPC can insert/update progress. The SECURITY DEFINER function uses auth.uid(), an empty search_path, authenticated-only execution and no caller-supplied owner ID. RLS remains enabled for reads.
- Insert a missing row only at expected version zero; stale updates cannot recreate deleted progress.
- Pin Supabase JS to 2.57.4 and load it dynamically so CDN failure leaves local tracking functional. Reject secret/service-role client keys.
- All original content, interface, task fields, CSV export and print remain.

## Backups and recovery

Use **Export progress (.json)** for the currently displayed state. Import that file using **Import progress (.json)**. Import replaces the local view and queues a version-checked save; it cannot silently replace a newer cloud version. Confirm **Saved to cloud** afterwards.

**Export recovery copies** downloads all locally retained pending/recovery records. This is an advanced recovery bundle: extract a copy's `state` and wrap it as `{"app":"enterprise-ai-architect","version":1,"state":...}` to import it. Keep recovery files private; they may include several accounts' notes from this browser. Browser data clearing removes local recovery copies, so retain portable JSON exports elsewhere.

## Updating

Edit source files on `main` (prefer a reviewed branch/PR for larger changes), run `node tests/verify.cjs` and JavaScript syntax checks, then commit. With Pages configured to main/root, GitHub republishes committed changes. Run schema.sql in Supabase only when database changes require it; do not reset the table. config.js must contain only the project URL and public publishable/anon key. Back up your progress before updating.

## Validation status

See TEST-REPORT.md. Simulated cloud tests do not prove live Auth, RLS or deployed cross-device persistence.
