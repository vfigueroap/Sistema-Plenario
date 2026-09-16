import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

// Session store table used by connect-pg-simple. Declared here so drizzle-kit
// push is aware of it and does not attempt to drop it (which would log every
// user out and breaks non-interactive post-merge pushes).
export const sessionTable = pgTable(
  "session",
  {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);
