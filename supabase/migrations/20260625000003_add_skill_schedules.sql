-- Migration: add_skill_schedules
-- ADR: docs/adr/0030-user-defined-skills.md
-- Spec: docs/specs/SPEC-018-client-and-skill-management.md
--
-- Optional recurrence for an operator-authored skill. The friendly picker (daily/weekly/hourly/
-- monthly) is a closed subset, so next_run_at is computable in PURE SQL — no cron parser in the
-- bash poller. A new poll-skill-schedules.sh ENQUEUES a job when one is due; poll-agent-jobs.sh
-- still executes it. One schedule per skill in v1 (unique skill_id). operator_id denormalized for
-- the scoped claim. The finest granularity is hourly (every_n_hours >= 1 ⇒ >= 60 min), which
-- already satisfies the >= 15 min anti-runaway floor.
--
-- RLS: authenticated operators SELECT their own; writes via service_role + ownership guard.

create table public.skill_schedules (
  id            uuid primary key default gen_random_uuid(),
  skill_id      uuid not null references public.client_skills(id) on delete cascade,
  client_id     uuid not null references public.clients(id) on delete cascade,
  operator_id   uuid not null references public.operators(id) on delete cascade,
  recurrence    jsonb not null,
  cron_expression text,
  timezone      text not null default 'America/Sao_Paulo',
  enabled       boolean not null default true,
  next_run_at   timestamptz not null,
  last_run_at   timestamptz,
  last_job_id   uuid references public.agent_jobs(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint skill_schedules_freq_check
    check (recurrence->>'freq' in ('hourly','daily','weekly','monthly')),
  unique (skill_id)
);

-- Poller hot path: an operator's enabled schedules ordered by when they're next due.
create index skill_schedules_due_idx on public.skill_schedules (operator_id, next_run_at)
  where enabled;

create trigger set_skill_schedules_updated_at before update on public.skill_schedules
  for each row execute function public.set_updated_at();

alter table public.skill_schedules enable row level security;

create policy skill_schedules_select_own on public.skill_schedules
  for select to authenticated
  using (operator_id = (select auth.uid()));

-- compute_next_run: the smallest future timestamp matching the recurrence, in the schedule's tz.
-- Pure function of its inputs (timezone db is treated as stable). Used at create/update time and
-- by the claim to advance the schedule atomically.
create or replace function public.compute_next_run(p_recurrence jsonb, p_tz text, p_from timestamptz)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_freq      text := p_recurrence->>'freq';
  v_time      text := coalesce(nullif(p_recurrence->>'time', ''), '00:00');
  v_local     timestamp := p_from at time zone p_tz;   -- wall-clock in tz
  v_today     date := v_local::date;
  v_candidate timestamp;
  v_n         int;
  v_dow       int;
  v_target    int;
  v_days      int;
begin
  if v_freq = 'hourly' then
    v_n := greatest(coalesce((p_recurrence->>'every_n_hours')::int, 1), 1);
    v_candidate := date_trunc('hour', v_local) + make_interval(hours => v_n);
  elsif v_freq = 'daily' then
    v_candidate := v_today + v_time::time;
    if v_candidate <= v_local then
      v_candidate := (v_today + 1) + v_time::time;
    end if;
  elsif v_freq = 'weekly' then
    v_target := coalesce((p_recurrence->>'weekday')::int, 0);  -- 0=Sunday .. 6=Saturday
    v_dow := extract(dow from v_today)::int;
    v_days := (v_target - v_dow + 7) % 7;
    v_candidate := (v_today + v_days) + v_time::time;
    if v_candidate <= v_local then
      v_candidate := v_candidate + interval '7 days';
    end if;
  elsif v_freq = 'monthly' then
    v_target := least(greatest(coalesce((p_recurrence->>'monthday')::int, 1), 1), 28);
    v_candidate := (date_trunc('month', v_local)::date + (v_target - 1)) + v_time::time;
    if v_candidate <= v_local then
      v_candidate := ((date_trunc('month', v_local) + interval '1 month')::date + (v_target - 1)) + v_time::time;
    end if;
  else
    raise exception 'invalid recurrence freq: %', v_freq;
  end if;

  return v_candidate at time zone p_tz;
end;
$$;

revoke execute on function public.compute_next_run(jsonb, text, timestamptz) from public, anon, authenticated;

-- Atomic claim for the schedule poller (one per operator runner, ADR 0027). Picks the oldest DUE
-- schedule whose skill is still active, and ADVANCES next_run_at in the same statement so the next
-- tick can't double-fire it. Returns the row; the poller enqueues a job and stamps last_job_id.
create or replace function public.claim_due_skill_schedule(p_operator_id uuid)
returns setof public.skill_schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.skill_schedules;
begin
  select s.* into v_row
    from public.skill_schedules s
   where s.enabled
     and s.next_run_at <= now()
     and s.operator_id = p_operator_id
     and exists (select 1 from public.client_skills cs where cs.id = s.skill_id and cs.status = 'active')
   order by s.next_run_at asc
   limit 1
   for update skip locked;

  if not found then
    return;
  end if;

  update public.skill_schedules
     set last_run_at = now(),
         next_run_at = public.compute_next_run(v_row.recurrence, v_row.timezone, now())
   where id = v_row.id
  returning * into v_row;

  return next v_row;
end;
$$;

revoke execute on function public.claim_due_skill_schedule(uuid) from public, anon, authenticated;
