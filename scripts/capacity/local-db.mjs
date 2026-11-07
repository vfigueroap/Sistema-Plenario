import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const require = createRequire(new URL("../package.json", import.meta.url));
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const root = fileURLToPath(new URL("../../", import.meta.url));
const modulePath = process.env.EMBEDDED_POSTGRES_MODULE;
const { default: EmbeddedPostgres } = await import(
  modulePath ? pathToFileURL(modulePath).href : "embedded-postgres"
);
const directory = path.join(os.tmpdir(), `plenario-capacity-${Date.now()}`);
fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
fs.mkdirSync(directory, { recursive: true });
const log = fs.createWriteStream(path.join(directory, "queries.log"));
const server = new EmbeddedPostgres({
  databaseDir: path.join(directory, "data"),
  user: "postgres",
  password: "capacity-local-only",
  port: 55438,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: [
    "-c",
    "max_connections=60",
    "-c",
    "shared_buffers=224MB",
    "-c",
    "log_statement=all",
    "-c",
    "log_line_prefix=%m [%p] ",
  ],
  onLog: (line) => log.write(line + "\n"),
  onError: (line) => log.write(line + "\n"),
});
await server.initialise();
await server.start();
for (const name of ["capacity_test", "plenario_test"]) {
  await server.createDatabase(name);
  const client = new Client({
    connectionString: `postgresql://postgres:capacity-local-only@127.0.0.1:55438/${name}`,
  });
  await client.connect();
  for (const file of fs
    .readdirSync(path.join(root, "lib/db/migrations/fresh"))
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    await client.query(
      fs.readFileSync(path.join(root, "lib/db/migrations/fresh", file), "utf8"),
    );
  }
  await client.query("set search_path to public");
  await client.query(
    `alter database ${name} set app.institution_id = '00000000-0000-4000-8000-000000000001'`,
  );
  await client.query(
    "select set_config('app.institution_id', '00000000-0000-4000-8000-000000000001', false)",
  );
  await client.query(
    "insert into institutions (id,slug,name) values ('00000000-0000-4000-8000-000000000001','capacity','Prueba ficticia')",
  );
  if (name === "capacity_test") {
    const hash = await bcrypt.hash("capacity-test-password", 10);
    await client.query(
      "insert into users (username,display_name,password,rol) values ('capacity_admin','Administración ficticia',$1,'admin')",
      [hash],
    );
    await client.query(
      `insert into users (username,display_name,password,rol,voting_weight,"group",faculty,created_at)
      select 'capacity_'||n, 'Integrante ficticio '||n, $1, 'miembro', 100.0/110, 'Consejeros FECh', 'Unidad ficticia', now()-interval '1 year'
      from generate_series(1,110) n`,
      [hash],
    );
    await client.query(`insert into plenarias (title,session_code,status,created_at,official_start_at,official_end_at)
      select 'Sesión ficticia '||n, 'TEST'||n, 'cerrada', now()-n*interval '7 days', now()-n*interval '7 days', now()-n*interval '7 days'+interval '3 hours'
      from generate_series(1,17) n`);
    await client.query(`insert into session_weights (session_id,user_id,weight,weight_alt)
      select s.id,u.id,u.voting_weight,0 from plenarias s cross join users u where u.rol='miembro'`);
    await client.query(`insert into attendance (session_id,user_id,modality)
      select s.id,u.id,(case when u.id%2=0 then 'online' else 'presencial' end)::attendance_modality from plenarias s cross join users u where u.rol='miembro' and u.id<=96`);
    await client.query(`insert into vote_topics (session_id,title,status)
      select s.id, 'Moción ficticia '||n, 'cerrado' from plenarias s cross join generate_series(1,4) n`);
    await client.query(`insert into vote_ballots (vote_topic_id,user_id,weight_at_vote)
      select t.id,u.id,u.voting_weight from vote_topics t cross join users u where u.rol='miembro' and u.id<=86`);
    await client.query(`insert into votes (vote_topic_id,user_id,ballot_id,option,weight_at_vote)
      select vote_topic_id,user_id,id,'favor',weight_at_vote from vote_ballots`);
    await client.query(
      `insert into agenda_points (session_id,title,position) select id,'Tabla ficticia',0 from plenarias`,
    );
    await client.query(`insert into speaking_turns (session_id,agenda_point_id,category,kind,status,position,duration_seconds,elapsed_seconds,user_id)
      select a.session_id,a.id,'pleno','individual','finalizada',u.id,60,55,u.id from agenda_points a cross join users u where u.rol='miembro' and u.id<=31`);
    await client.query("analyze");
  }
  console.log(
    JSON.stringify({
      database: name,
      maxConnections: (await client.query("show max_connections")).rows[0],
      sharedBuffers: (await client.query("show shared_buffers")).rows[0],
    }),
  );
  await client.end();
}
fs.writeFileSync(
  path.join(root, "tmp", "capacity-db.json"),
  JSON.stringify({ directory, log: path.join(directory, "queries.log") }),
);
console.log("Base local lista");
process.on("SIGINT", async () => {
  await server.stop();
  process.exit();
});
setInterval(() => {}, 60000);
