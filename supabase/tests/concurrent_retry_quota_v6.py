"""LOCAL TEST ONLY: nineteen failures leave exactly one concurrent retry slot.

Usage: python3 supabase/tests/concurrent_retry_quota_v6.py CONTAINER_NAME
Requires the isolated local bootstrap and migrations through public Explore.
"""
from concurrent.futures import ThreadPoolExecutor
import subprocess
import sys

container=sys.argv[1]
user_id='6a000000-0000-4000-8000-000000000001'


def query(sql):
    return subprocess.run(['docker','exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-qAt'],
                          input=sql,text=True,capture_output=True,check=False)


fixture=query(f"""insert into auth.users(id,email) values('{user_id}','retry-cap@example.invalid');
insert into public.caption_generations(user_id,image_id,prompt,system_prompt,style,model,request_id,status,completed_at)
select '{user_id}','earth','Fixture prompt','Fixture system','dry','deepseek-flash',gen_random_uuid(),'failed',now()
from generate_series(1,19);""")
if fixture.returncode:
    raise RuntimeError(fixture.stderr)


def retry(attempt):
    result=query(f"""begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','{user_id}',true);
select set_config('request.jwt.claim.role','authenticated',true);
select public.fail_caption_generation(id) from public.reserve_caption_generation_v5(
 '6b000000-0000-4000-8000-{attempt:012d}','earth','Retry context','dry','System','deepseek-flash');
commit;""")
    if result.returncode==0:
        return 'accepted'
    if 'GENERATION_ATTEMPT_LIMIT_REACHED' in result.stderr:
        return 'limited'
    raise RuntimeError(result.stderr)


try:
    with ThreadPoolExecutor(max_workers=12) as pool:
        results=list(pool.map(retry,range(1,13)))
    count=query(f"select count(*) from public.caption_generations where user_id='{user_id}' and status='failed';")
    if count.returncode:
        raise RuntimeError(count.stderr)
    assert results.count('accepted')==1,results
    assert results.count('limited')==11,results
    assert count.stdout.strip()=='20',count.stdout
    print('PASS: nineteen failures plus twelve concurrent retries produced exactly twenty failures; eleven retries were limited.')
finally:
    query(f"delete from auth.users where id='{user_id}';")
