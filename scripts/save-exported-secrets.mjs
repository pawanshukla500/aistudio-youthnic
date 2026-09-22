import pg from "pg";

const { Client } = pg;
const dbUrl = process.env.RAILWAY_DATABASE_URL;
const secretsRaw = process.env.SECRETS_JSON;

if (!dbUrl || !secretsRaw) {
  console.error("Missing RAILWAY_DATABASE_URL or SECRETS_JSON");
  process.exit(1);
}

const secrets = JSON.parse(secretsRaw);

async function main() {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS public._migrated_secrets (
      key text PRIMARY KEY,
      value text NOT NULL,
      migrated_at timestamptz DEFAULT now()
    );
  `);

  for (const [key, value] of Object.entries(secrets)) {
    if (value && typeof value === "string") {
      await client.query(`
        INSERT INTO public._migrated_secrets (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
      `, [key, value]);
      console.log(`Saved secret key: ${key} (length: ${value.length})`);
    }
  }

  await client.end();
  console.log("All secrets successfully saved to Railway Postgres _migrated_secrets");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
