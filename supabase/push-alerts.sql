-- Missing Numbers: draw alerts (the "Notify me" bell). Added 22 Nov 2026.
-- Already applied to the live Supabase project; kept here as a record.
--
-- How it stays private:
--   * Nobody can read or write the tables directly (RLS on, no policies, no table grants).
--   * The site calls 3 small functions: push_save, push_remove, push_opened. Each one only
--     touches the row for the phone's own push address (which only that phone knows).
--   * The alert sender (GitHub Actions) calls push_due / push_done with a long secret token.
--     Only a SHA-256 hash of that token is stored here (table push_sender).

create table if not exists public.push_alerts (
  endpoint       text primary key
                 check (length(endpoint) < 1024 and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com)/'),
  p256dh         text not null check (length(p256dh) between 40 and 200),
  auth           text not null check (length(auth) between 10 and 100),
  games          text[] not null check (games <@ array['boledo','lottery','fantasy5','pick3'] and cardinality(games) between 1 and 4),
  mine           jsonb not null default '{}'::jsonb check (jsonb_typeof(mine) = 'object' and length(mine::text) < 2000),
  mode           text not null default 'each' check (mode in ('each','weekly')),
  unopened       int  not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_sent_at   timestamptz,
  last_opened_at timestamptz
);

-- one row per draw already alerted (or skipped), plus 'weekly-YYYY-MM-DD' for the weekly roundup
create table if not exists public.push_sent (
  id      text primary key check (length(id) < 80),
  sent_at timestamptz not null default now(),
  count   int not null default 0
);

create table if not exists public.push_sender (
  token_hash text primary key
);

alter table public.push_alerts enable row level security;
alter table public.push_sent   enable row level security;
alter table public.push_sender enable row level security;
revoke all on public.push_alerts, public.push_sent, public.push_sender from anon, authenticated;

-- ---------- called by the site ----------

-- turn alerts on, or change which games / Lucky Numbers are included
create or replace function public.push_save(p_endpoint text, p_p256dh text, p_auth text, p_games text[], p_mine jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.push_alerts (endpoint, p256dh, auth, games, mine)
  values (p_endpoint, p_p256dh, p_auth, p_games, coalesce(p_mine, '{}'::jsonb))
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, games = excluded.games, mine = excluded.mine,
        mode = 'each', unopened = 0, updated_at = now();
end $$;

-- turn alerts off
create or replace function public.push_remove(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_alerts where endpoint = p_endpoint;
$$;

-- an alert was tapped: reset the "ignored" count and go back to an alert every draw
create or replace function public.push_opened(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  update public.push_alerts set unopened = 0, mode = 'each', last_opened_at = now() where endpoint = p_endpoint;
$$;

-- the phone replaced its push address (rare): move the settings to the new one
create or replace function public.push_move(p_old text, p_endpoint text, p_p256dh text, p_auth text)
returns void language sql security definer set search_path = '' as $$
  update public.push_alerts set endpoint = p_endpoint, p256dh = p_p256dh, auth = p_auth, updated_at = now()
  where endpoint = p_old;
$$;

-- ---------- called by the alert sender (GitHub Actions) ----------

create or replace function public.push_token_ok(p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.push_sender
                 where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex'));
$$;
revoke all on function public.push_token_ok(text) from public, anon, authenticated;

-- everything the sender needs: subscribers, and which of the given draw ids were already handled
create or replace function public.push_due(p_token text, p_ids text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.push_token_ok(p_token) then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'subs', coalesce((select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth,
                        'games', games, 'mine', mine, 'mode', mode, 'unopened', unopened))
                      from public.push_alerts), '[]'::jsonb),
    'done', coalesce((select jsonb_agg(id) from public.push_sent where id = any(p_ids)), '[]'::jsonb));
end $$;

-- record a send: draw ids handled, phones reached, phones gone, phones switched to the weekly roundup
create or replace function public.push_done(p_token text, p_ids text[], p_sent text[], p_gone text[], p_paused text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.push_token_ok(p_token) then raise exception 'not allowed'; end if;
  insert into public.push_sent (id, count)
    select i, coalesce(cardinality(p_sent), 0) from unnest(coalesce(p_ids, '{}')) i
    on conflict (id) do nothing;
  update public.push_alerts set unopened = unopened + 1, last_sent_at = now()
    where endpoint = any(coalesce(p_sent, '{}'));
  update public.push_alerts set mode = 'weekly'
    where endpoint = any(coalesce(p_paused, '{}'));
  delete from public.push_alerts where endpoint = any(coalesce(p_gone, '{}'));
end $$;

revoke all on function public.push_save(text, text, text, text[], jsonb), public.push_remove(text), public.push_opened(text),
  public.push_move(text, text, text, text), public.push_due(text, text[]), public.push_done(text, text[], text[], text[], text[])
  from public;
grant execute on function public.push_save(text, text, text, text[], jsonb), public.push_remove(text), public.push_opened(text),
  public.push_move(text, text, text, text), public.push_due(text, text[]), public.push_done(text, text[], text[], text[], text[])
  to anon, authenticated;

-- The sender token's hash is added separately (never stored in this file):
--   insert into public.push_sender (token_hash) values ('<sha256 hex of PUSH_SENDER_TOKEN>');
