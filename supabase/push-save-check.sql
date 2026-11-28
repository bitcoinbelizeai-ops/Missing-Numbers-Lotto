-- Missing Numbers: stricter check on alert sign-ups (security review, 27 Nov 2026).
-- Run ONCE in Supabase > SQL Editor. Safe to run again (it only replaces push_save).
--
-- Why: anyone can call push_save with the public key (that's how the bell works). Before this,
-- the Lucky Numbers ("mine") were only checked to be an object under 2,000 characters, so a row
-- like {"boledo": 5} could be saved and crashed the alert sender for everyone.
-- scripts/send_alerts.py now skips such rows too; this stops them being saved at all.
-- The site's bell always sends {"<game>": ["24", ...]} (Pick 3 as "spot:digit", e.g. "0:7") with up to 12 numbers, so it keeps working.

create or replace function public.push_save(p_endpoint text, p_p256dh text, p_auth text, p_games text[], p_mine jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m jsonb := coalesce(p_mine, '{}'::jsonb);
  k text;
  v jsonb;
begin
  if jsonb_typeof(m) <> 'object' then raise exception 'bad lucky numbers'; end if;
  for k, v in select * from jsonb_each(m) loop
    if not (k = any(array['boledo','lottery','fantasy5','pick3']))
       or jsonb_typeof(v) <> 'array'
       or jsonb_array_length(v) > 12
       or exists (select 1 from jsonb_array_elements(v) e
                  where jsonb_typeof(e) <> 'string' or not (e #>> '{}') ~ '^([0-9]{1,4}|[0-2]:[0-9])$') then
      raise exception 'bad lucky numbers';
    end if;
  end loop;
  insert into public.push_alerts (endpoint, p256dh, auth, games, mine)
  values (p_endpoint, p_p256dh, p_auth, p_games, m)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, games = excluded.games, mine = excluded.mine,
        mode = 'each', unopened = 0, updated_at = now();
end $$;

-- keep the same permissions as before
revoke all on function public.push_save(text, text, text, text[], jsonb) from public;
grant execute on function public.push_save(text, text, text, text[], jsonb) to anon, authenticated;

-- Check (should return 0): rows saved before this change with odd Lucky Numbers
-- select count(*) from public.push_alerts a, jsonb_each(a.mine) j where jsonb_typeof(j.value) <> 'array';
