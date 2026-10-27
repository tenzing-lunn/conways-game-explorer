# Operations guide

This guide describes the implemented boundaries and the checks required before
a release operation. It does not claim that a production backup, migration, or
deployment has already happened.

## Runtime boundaries

The browser is local-first when no database runtime configuration is present.
With PostgreSQL configured, Better Auth owns password accounts and sessions;
the server repository owns community data. The browser never receives the
database connection string or Better Auth secret. Cloudflare Worker runtime
configuration uses a server-only Hyperdrive binding.

Keep `DATABASE_URL`, `BETTER_AUTH_SECRET`, and any optional Better Auth API key
out of browser configuration, logs, screenshots, commits, and support text.
Use same-origin requests and preserve the origin check on mutating community
routes.

## Routine checks

Run the unit suite, Worker build, syntax checks, and browser suite from the
repository before a release. Run the disposable PostgreSQL lifecycle harness
against a fresh database for migrations, ownership, public snapshot isolation,
guest import, recovery/session revocation, and deletion behavior. Do not count
the local repository fallback as proof of the cloud path.

Inspect public routes as a signed-out visitor and confirm that only the
published projection is returned. Check that a private save leaves the public
version and metadata unchanged until explicit Publish. Check unpublish,
archive, restore, delete, report, comment ownership, and cross-user access.

## Backup and restore procedure for T8

The executed 2026-09-13 backup, restore test, migrations, Worker versions, and
exact release rollback reference are recorded in `t8-release.md`.

1. Record the database provider, schema migration IDs, Worker version, and
   current public route behavior without printing secrets.
2. Take a provider-supported PostgreSQL backup or snapshot and record its
   timestamp/restore identifier in the release notes.
3. Apply migrations `0002_publish_readiness.sql` and `0003_public_lab.sql` in
   order through the reviewed migration runner, with writes controlled as the
   release plan requires.
4. Run the disposable or controlled lifecycle and authorization checks against
   the resulting schema. Verify public snapshot isolation and account deletion
   before opening the service.
5. If rollback is required, stop writes, restore the recorded database backup
   or provider restore point into a controlled target, reconnect the prior
   Worker version, and rerun route/auth checks. Do not improvise a destructive
   SQL rollback for append-only versions or account data.

The migrations define cascades for owned account/community rows and set a
comment author to null when its author account is deleted. Treat a database
restore and account deletion as material operations requiring an explicit
operator record.

## Moderation and deletion boundaries

Reports are authenticated submissions with a bounded reason and rate limit.
They are stored in `content_reports`; review and resolution are operator work.
Public reads filter archived and hidden creations. Owners can unpublish,
archive, delete, and restore versions according to repository ownership checks.
Account deletion is password-confirmed and Better Auth session/account records
and owned content are removed through the configured database cascades. There
is no documented retention period, email workflow, or support address in this
release.

## Moderation SQL

There is no admin UI. Run these in the provider's SQL console against the
production database, one statement at a time, and record what you changed.
Replace the quoted placeholders. Public reads only return creations with
`visibility = 'public'`, `archived_at is null` and
`moderation_status = 'visible'`, so `hidden` takes a creation off every public
route, feed, profile and remix list at once.

Review open reports:

```sql
select r.id as report_id, r.created_at, r.reason, c.slug, c.title,
       p.username as owner_username, rp.username as reporter_username
  from public.content_reports r
  join public.creations c on c.id = r.creation_id
  join public.profiles p on p.id = c.owner_id
  left join public.profiles rp on rp.id = r.reporter_id
 where r.resolved_at is null
 order by r.created_at;
```

Hide a creation (reversible; the owner cannot republish it while hidden, because
publishing does not reset `moderation_status`):

```sql
update public.creations set moderation_status = 'hidden'
 where slug = 'the-creation-slug' returning id, title, owner_id;
-- Undo: set moderation_status = 'visible'.
```

Unpublish a creation without hiding it (the owner can publish again):

```sql
update public.creations set visibility = 'private', published_at = null
 where slug = 'the-creation-slug' returning id, title;
```

Remove a comment (soft delete, as the app does):

```sql
update public.comments set deleted_at = now(), updated_at = now()
 where id = 'comment-uuid' and deleted_at is null returning creation_id;
```

Mark reports resolved:

```sql
update public.content_reports set resolved_at = now()
 where creation_id = (select id from public.creations where slug = 'the-creation-slug')
   and resolved_at is null;
```

Disable a user. There is no ban column, so this signs them out everywhere,
removes their password login and recovery key (sign-in then fails, and the
email cannot be registered again because the user row still exists), and hides
their profile, creations and comments. Run it as one transaction:

```sql
begin;
select id, email, name from public.auth_users where email = 'user@example.com';
-- Copy the id from the row above into every statement below.
delete from public.auth_sessions where user_id = 'user-id';
delete from public.auth_accounts where user_id = 'user-id' and provider_id = 'credential';
delete from public.recovery_keys where user_id = 'user-id';
update public.profiles set is_public = false where id = 'user-id';
update public.creations set moderation_status = 'hidden' where owner_id = 'user-id';
update public.comments set deleted_at = now(), updated_at = now()
 where author_id = 'user-id' and deleted_at is null;
commit;
```

To erase the account and everything it owns instead, run
`delete from public.auth_users where id = 'user-id';`. The schema cascades to
sessions, accounts, profile, creations, versions, stars and imports, and sets
the author of that user's comments on other creations to null.

## Abuse limits

These limits are enforced in code; none needs a migration.

- Cloudflare Rate Limiting bindings in `wrangler.jsonc`, keyed on
  `cf-connecting-ip`: `AUTH_RATE_LIMITER` allows 10 sign-in/sign-up POSTs per
  minute, `WRITE_RATE_LIMITER` 120 community writes per minute. A missing
  binding (local dev) allows the request.
- Better Auth's own limiter (in-memory, per isolate): 10 sign-ins per minute
  and 10 sign-ups per hour per IP, 100 other auth requests per minute.
- Per account: 120 community writes per minute (`action_limits`), 200
  projects, 500 versions per project and per import, 50 MB of stored RLE
  including unfinished import uploads.
- Profiles: display name 60 characters, bio 500, URLs 300 and `https:` only.
