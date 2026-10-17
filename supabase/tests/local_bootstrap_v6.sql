-- LOCAL TEST ONLY: Supabase already provides these helpers in a live project.
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
    coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role');
$$;
-- Model the documented operation-aware behavior; no operation means false.
create function storage.allow_any_operation(operations text[]) returns boolean language sql stable as $$
  select exists(select 1 from unnest(operations) x(operation)
    where regexp_replace(x.operation,'^storage\.','') =
      regexp_replace(nullif(current_setting('storage.test_operation',true),''),'^storage\.',''));
$$;
