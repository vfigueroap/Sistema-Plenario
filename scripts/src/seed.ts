import pg from "pg";
import bcrypt from "bcryptjs";

async function seed() {
  const connectionString = process.env.DATABASE_URL;
  const institutionId = process.env.BOOTSTRAP_INSTITUTION_ID?.trim();
  const institutionSlug = process.env.BOOTSTRAP_INSTITUTION_SLUG?.trim();
  const institutionName = process.env.BOOTSTRAP_INSTITUTION_NAME?.trim();
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim();
  const displayName = process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME?.trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  // Validate before creating a pool: missing configuration must never touch a DB.
  if (!connectionString || !institutionId || !institutionSlug || !institutionName || !username || !displayName || !password) {
    console.error("Se requieren DATABASE_URL, las variables BOOTSTRAP_INSTITUTION_* y las variables BOOTSTRAP_ADMIN_*.");
    process.exitCode = 1;
    return;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(institutionId)) {
    console.error("BOOTSTRAP_INSTITUTION_ID debe ser un UUID válido.");
    process.exitCode = 1;
    return;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(institutionSlug)) {
    console.error("BOOTSTRAP_INSTITUTION_SLUG debe usar minúsculas, números y guiones.");
    process.exitCode = 1;
    return;
  }
  if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    console.error("BOOTSTRAP_ADMIN_PASSWORD debe tener al menos 12 caracteres y como máximo 72 bytes UTF-8.");
    process.exitCode = 1;
    return;
  }

  const hashed = await bcrypt.hash(password, 12);
  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.institution_id', $1, true)", [institutionId]);
    await client.query(
      `INSERT INTO institutions (id, slug, name)
       VALUES ($1::uuid, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [institutionId, institutionSlug, institutionName],
    );
    const result = await client.query(
      `INSERT INTO users (institution_id, username, display_name, password, voting_weight, rol)
       VALUES ($1::uuid, $2, $3, $4, $5, $6)
       ON CONFLICT (institution_id, username) DO NOTHING`,
      [institutionId, username, displayName, hashed, "0", "admin"],
    );
    console.log(result.rowCount === 1
      ? "Administrador inicial creado."
      : "El usuario ya existe; no se modificaron sus credenciales ni su rol.");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => {
  // Driver errors can include connection details; never print them or credentials.
  console.error("No se pudo completar el bootstrap de administración.");
  process.exitCode = 1;
});
