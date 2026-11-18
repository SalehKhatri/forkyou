-- Load-test data: 2,000 users with API keys and 30 days of coding sessions (~2.7M rows).
-- Only for a throwaway database. See apps/api/scripts/load/README.md.
--
-- Each user gets 0-90 four-minute sessions a day (about 3 hours on average) between 09:00 and
-- 16:30 UTC, never overlapping, on each of the last 30 days. Today is left empty for the load
-- test's own uploads. User N's API key is `fy_load_N`.

\set ON_ERROR_STOP on
\timing on

begin;

insert into users (github_id, username)
select 8000000 + i, 'load' || i
from generate_series(1, 2000) as i;

insert into api_keys (user_id, name, key_hash, key_prefix)
select id, 'load test', encode(sha256(convert_to('fy_load_' || substr(username, 5), 'UTF8')), 'hex'), 'fy_load'
from users
where username like 'load%';

insert into coding_sessions (id, user_id, started_at, ended_at, duration_seconds, language, project, editor)
select gen_random_uuid(),
       u.id,
       s.started_at,
       s.started_at + interval '240 seconds',
       240,
       (array['typescript', 'python', 'rust', 'go', 'java', 'typescriptreact'])[1 + floor(random() * 6)::int],
       'project-' || floor(random() * 5)::int,
       'vscode'
from users u
cross join generate_series(1, 30) as d
-- Referencing d makes Postgres draw a new random count for every user-day.
cross join lateral generate_series(0, floor(random() * 90 + d * 0)::int - 1) as k
cross join lateral (
  select date_trunc('day', now()) - make_interval(days => d) + interval '9 hours'
         + make_interval(mins => k * 5) as started_at
) as s
where u.username like 'load%';

-- Sessions were inserted directly rather than through the API, so fill the rollup the way the
-- backfill migration does (ADR 0006).
insert into daily_stats (user_id, day, language, seconds)
select user_id, (started_at at time zone 'UTC')::date, language, sum(duration_seconds)::int
from coding_sessions
where user_id in (select id from users where username like 'load%')
group by 1, 2, 3;

commit;

vacuum analyze;

select count(*) as users from users where username like 'load%';
select count(*) as sessions, pg_size_pretty(pg_total_relation_size('coding_sessions')) as table_size
from coding_sessions;
