import { institutionIdColumn } from "./institutions";
import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  pgEnum,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { plenariasTable } from "./sessions";

// Qué se espera de quien recibe el mensaje.
export const messageKindEnum = pgEnum("message_kind", [
  // Cita a un pleno y pide responder si asistirá y de qué forma.
  "citacion",
  // Aviso que no espera respuesta.
  "informativo",
]);

// Respuesta a una citación. La modalidad se declara al confirmar, porque a la
// Mesa le sirve saber cuánta gente estará en sala y cuánta conectada antes de
// la sesión, no solo cuántas personas vendrán.
export const messageReplyEnum = pgEnum("message_reply", [
  "presencial",
  "online",
  "justificada",
]);

// Qué resolvió administración sobre una justificación.
export const replyReviewEnum = pgEnum("reply_review", ["pendiente", "aceptada", "rechazada"]);

export const internalMessagesTable = pgTable(
  "internal_messages",
  {
    institutionId: institutionIdColumn(),
    id: serial("id").primaryKey(),
    // Un mensaje puede referirse a un pleno concreto o no referirse a ninguno
    // (extra-pleno). Esa distinción es la que permite saber, de una citación,
    // a qué sesión corresponden las confirmaciones.
    sessionId: integer("session_id").references(() => plenariasTable.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    kind: messageKindEnum("kind").notNull().default("informativo"),
    // Fecha límite para responder, cuando corresponde.
    replyDeadline: timestamp("reply_deadline", { withTimezone: true }),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_internal_messages_session").on(t.sessionId)],
);

// Un destinatario por fila: así cada persona tiene su propio estado de lectura
// y su propia respuesta, sin que el mensaje original cambie.
export const messageRecipientsTable = pgTable(
  "message_recipients",
  {
    institutionId: institutionIdColumn(),
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .notNull()
      .references(() => internalMessagesTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }),

    // Respuesta de la persona. Nula mientras no responde.
    reply: messageReplyEnum("reply"),
    replyReason: text("reply_reason"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),

    // Resolución de administración sobre una justificación. Solo tiene sentido
    // cuando reply = "justificada".
    //
    // Aceptar una justificación NO cambia el quórum ni habilita a votar: la
    // persona sigue siendo ausente. Lo único que cambia es la etiqueta del
    // acta, que se registra aparte en justified_absences.
    review: replyReviewEnum("review"),
    reviewNote: text("review_note"),
    reviewedBy: integer("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [
    unique("message_recipient_unique").on(t.messageId, t.userId),
    index("idx_message_recipients_user").on(t.userId),
  ],
);

export const insertInternalMessageSchema = createInsertSchema(internalMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertInternalMessage = z.infer<typeof insertInternalMessageSchema>;
export type InternalMessage = typeof internalMessagesTable.$inferSelect;
export type MessageRecipient = typeof messageRecipientsTable.$inferSelect;
