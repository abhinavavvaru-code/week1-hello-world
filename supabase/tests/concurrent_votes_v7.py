"""Isolated LOCAL database only. Usage: python3 concurrent_votes_v7.py CONTAINER.

Exercises concurrent changes to the same rating and independent owners. No network
or production database is contacted; fixture rows are removed on completion.
"""
from concurrent.futures import ThreadPoolExecutor
import json
import subprocess
import sys

container = sys.argv[1]
user = 'b1000000-0000-4000-8000-000000000001'
other = 'b1000000-0000-4000-8000-000000000002'
generation = 'b2000000-0000-4000-8000-000000000001'
caption = 'b3000000-0000-4000-8000-000000000001'


def query(sql):
    result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def vote(who, value):
    output = query(f"""begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','{who}',true);
select set_config('request.jwt.claims','{{"role":"authenticated"}}',true);
select public.set_caption_vote_v7('{caption}',{value});
commit;""")
    return json.loads(output.splitlines()[-1])


query(f"""insert into auth.users(id,email) values('{user}','concurrent-vote@example.invalid'),('{other}','independent-vote@example.invalid');
insert into public.caption_generations(id,user_id,image_id,prompt,system_prompt,style,model,request_id,status,completed_at)
 values('{generation}','{user}','earth','Fixture','Fixture system','dry','deepseek-flash',gen_random_uuid(),'succeeded',now());
insert into public.captions(id,generation_id,content,position) values('{caption}','{generation}','My calendar has filed for a transfer.',1);""")
try:
    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(lambda n: vote(user, 1 if n % 2 else -1), range(24)))
    assert all(int(result['laughs']) + int(result['groans']) == 1 for result in results), results
    assert query(f"select count(*) from public.caption_votes where caption_id='{caption}';") == '1'
    vote(other, -1)
    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(lambda n: vote(user, 0 if n % 2 else 1), range(24)))
    assert all(int(result['groans']) == 1 for result in results), 'Undo altered another owner rating'
    final = vote(user, 1)
    assert (final['laughs'], final['groans']) == (1, 1), final
    assert query(f"select count(*) from public.caption_votes where caption_id='{caption}';") == '2'
    assert query(f"select bool_and(updated_at>=created_at) from public.caption_votes where caption_id='{caption}';") == 't'
    print('PASS: 48 concurrent changes/undo preserved one rating per owner, independent-owner rows, server timestamps and exact aggregate counts.')
finally:
    query(f"delete from public.caption_generations where id='{generation}';delete from auth.users where id in ('{user}','{other}');")
