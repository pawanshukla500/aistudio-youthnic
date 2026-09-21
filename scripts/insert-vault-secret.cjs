const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://supabase_admin:9rcfkuq6ntgpze1is7q3368k1vm949wa58xu89x0yfwo32gifizhgomeon1us1ss@zephyr.proxy.rlwy.net:40295/postgres?sslmode=disable'
  });
  await client.connect();
  try {
    const verify = await client.query(`SELECT name, decrypted_secret FROM vault.decrypted_secrets WHERE name = 'catalog_worker_secret';`);
    console.log('Verified decrypted vault secret:', verify.rows);
  } catch (e) {
    console.log('Vault insert notice:', e.message);
  }
  await client.end();
}

main().catch(console.error);
