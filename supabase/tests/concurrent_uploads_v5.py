"""LOCAL TEST ONLY: 32 simultaneous Storage inserts must accept exactly 20.

Usage: python3 supabase/tests/concurrent_uploads_v5.py CONTAINER_NAME
Requires the isolated local bootstrap plus both migrations. No live Storage API is used.
"""

from concurrent.futures import ThreadPoolExecutor
import subprocess
import sys

container = sys.argv[1]
user_id = "58000000-0000-4000-8000-000000000001"


def query(sql):
    return subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"],
        input=sql, text=True, capture_output=True, check=False,
    )


fixture = query(f"insert into auth.users(id,email) values ('{user_id}','v5-race@example.invalid');")
if fixture.returncode:
    raise RuntimeError(fixture.stderr)


def upload(attempt):
    image_id = f"59000000-0000-4000-8000-{attempt:012d}"
    result = query(f"""begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','{user_id}',true);
select set_config('request.jwt.claim.role','authenticated',true);
insert into storage.objects(bucket_id,name) values ('caption-uploads','{user_id}/{image_id}.jpg');
commit;
""")
    if result.returncode == 0:
        return "accepted"
    if "row-level security" in result.stderr:
        return "limited"
    raise RuntimeError(result.stderr)


try:
    with ThreadPoolExecutor(max_workers=32) as pool:
        results = list(pool.map(upload, range(1, 33)))
    count = query(f"select count(*) from storage.objects where bucket_id='caption-uploads' and split_part(name,'/',1)='{user_id}';")
    if count.returncode:
        raise RuntimeError(count.stderr)
    assert results.count("accepted") == 20, results
    assert results.count("limited") == 12, results
    assert count.stdout.strip() == "20", count.stdout
    print("PASS: 32 concurrent Storage inserts created exactly 20 rows; 12 were denied.")
finally:
    query(f"delete from storage.objects where bucket_id='caption-uploads' and split_part(name,'/',1)='{user_id}';")
    query(f"delete from auth.users where id='{user_id}';")
