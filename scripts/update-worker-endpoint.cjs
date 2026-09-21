const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://supabase_admin:9rcfkuq6ntgpze1is7q3368k1vm949wa58xu89x0yfwo32gifizhgomeon1us1ss@zephyr.proxy.rlwy.net:40295/postgres?sslmode=disable'
  });
  await client.connect();
  try {
    await client.query(`
create or replace function private.dispatch_app_worker(operation_name text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, vault, extensions
as $$
declare
  worker_secret text;
begin
  select decrypted_secret
    into worker_secret
  from vault.decrypted_secrets
  where name = 'catalog_worker_secret'
  order by created_at desc
  limit 1;

  if coalesce(worker_secret, '') = '' then
    raise warning 'catalog_worker_secret is not installed in Supabase Vault';
    return;
  end if;

  perform net.http_post(
    url := 'https://functions-production-b062.up.railway.app/app-api',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || worker_secret
    ),
    body := jsonb_build_object('operation', operation_name, 'args', '{}'::jsonb),
    timeout_milliseconds := 15000
  );
end;
$$;
    `);
    console.log('Successfully updated private.dispatch_app_worker to Railway direct functions endpoint!');
    await client.query("select private.dispatch_app_worker('worker');");
    console.log('Worker dispatch test query executed without error!');
  } catch (e) {
    console.error('Error updating function:', e.message);
  }
  await client.end();
}

main().catch(console.error);
