"""LOCAL TEST ONLY: race twelve independent reservations against a five-attempt cap.

Usage: python3 supabase/tests/concurrent_reservations.py CONTAINER_NAME
Requires an isolated Postgres container initialized with local_bootstrap.sql and the migration.
"""

from concurrent.futures import ThreadPoolExecutor
import subprocess
import sys


container = sys.argv[1]
user_id = "10000000-0000-4000-8000-000000000003"


def query(sql):
    return subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"],
        input=sql,
        text=True,
        capture_output=True,
        check=False,
    )


fixture = query(f"insert into auth.users(id,email) values ('{user_id}','assignment4-race@example.invalid');")
if fixture.returncode:
    raise RuntimeError(fixture.stderr)


def reserve(attempt):
    request_id = f"30000000-0000-4000-8000-{attempt:012d}"
    sql = f"""begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','{user_id}',true);
select id from public.reserve_caption_generation(
  '{request_id}','udp','Concurrent quota test','dry','Generate three captions.','deepseek-flash');
commit;
"""
    result = query(sql)
    if result.returncode == 0:
        return "accepted"
    if "GENERATION_LIMIT_REACHED" in result.stderr:
        return "limited"
    raise RuntimeError(result.stderr)


try:
    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(reserve, range(1, 13)))
    count = query(f"select count(*) from public.caption_generations where user_id='{user_id}';")
    if count.returncode:
        raise RuntimeError(count.stderr)
    assert results.count("accepted") == 5, results
    assert results.count("limited") == 7, results
    assert count.stdout.strip() == "5", count.stdout
    print("PASS: twelve concurrent reservations created exactly five rows; seven were limited.")
finally:
    query(f"delete from auth.users where id='{user_id}';")
