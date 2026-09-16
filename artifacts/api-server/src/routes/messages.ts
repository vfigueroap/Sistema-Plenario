import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  internalMessagesTable,
  messageRecipientsTable,
  usersTable,
  plenariasTable,
  justifiedAbsencesTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

type Kind = "citacion" | "informativo";
type Reply = "presencial" | "online" | "justificada";
type Review = "pendiente" | "aceptada" | "rechazada";

const KINDS: Kind[] = ["citacion", "informativo"];
const REPLIES: Reply[] = ["presencial", "online", "justificada"];

// Confirmar es asistir, sea en sala o conectade.
const esConfirmacion = (r: Reply | string | null) => r === "presencial" || r === "online";

function parseId(raw: string | string[]): number | null {
  const v = parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
  return isNaN(v) ? null : v;
}

// ─── Buzón propio ────────────────────────────────────────────────────────────

router.get("/messages", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;

  const rows = await db
    .select({
      recipientId: messageRecipientsTable.id,
      readAt: messageRecipientsTable.readAt,
      reply: messageRecipientsTable.reply,
      replyReason: messageRecipientsTable.replyReason,
      repliedAt: messageRecipientsTable.repliedAt,
      review: messageRecipientsTable.review,
      reviewNote: messageRecipientsTable.reviewNote,
      id: internalMessagesTable.id,
      subject: internalMessagesTable.subject,
      body: internalMessagesTable.body,
      kind: internalMessagesTable.kind,
      replyDeadline: internalMessagesTable.replyDeadline,
      createdAt: internalMessagesTable.createdAt,
      sessionId: internalMessagesTable.sessionId,
      sessionTitle: plenariasTable.title,
      sessionScheduledAt: plenariasTable.scheduledAt,
    })
    .from(messageRecipientsTable)
    .innerJoin(
      internalMessagesTable,
      eq(messageRecipientsTable.messageId, internalMessagesTable.id),
    )
    .leftJoin(plenariasTable, eq(internalMessagesTable.sessionId, plenariasTable.id))
    .where(eq(messageRecipientsTable.userId, userId))
    .orderBy(sql`${internalMessagesTable.createdAt} DESC`);

  res.json(rows);
});

// Marcar como leído.
router.post("/messages/:id/read", requireAuth, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  await db
    .update(messageRecipientsTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(messageRecipientsTable.messageId, id),
        eq(messageRecipientsTable.userId, req.session.userId!),
        sql`${messageRecipientsTable.readAt} IS NULL`,
      ),
    );
  res.sendStatus(204);
});

// Responder: confirmar asistencia o justificar inasistencia.
router.post("/messages/:id/reply", requireAuth, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const { reply, reason } = req.body as { reply?: string; reason?: string };
  if (!reply || !REPLIES.includes(reply as Reply)) {
    res.status(400).json({ error: "Respuesta inválida" });
    return;
  }
  // Una justificación sin motivo no le sirve a nadie para decidir.
  if (reply === "justificada" && !String(reason ?? "").trim()) {
    res.status(400).json({ error: "La justificación requiere un motivo" });
    return;
  }

  const [message] = await db
    .select()
    .from(internalMessagesTable)
    .where(eq(internalMessagesTable.id, id));
  if (!message) {
    res.status(404).json({ error: "Mensaje no encontrado" });
    return;
  }
  if (message.kind !== "citacion") {
    res.status(400).json({ error: "Este mensaje no admite confirmación de asistencia" });
    return;
  }
  if (message.replyDeadline && message.replyDeadline.getTime() < Date.now()) {
    res.status(409).json({ error: "El plazo para responder ya venció" });
    return;
  }

  const [updated] = await db
    .update(messageRecipientsTable)
    .set({
      reply: reply as Reply,
      replyReason: reply === "justificada" ? String(reason).trim() : null,
      repliedAt: new Date(),
      // Cambiar de respuesta reabre la revisión: una justificación nueva no
      // hereda el visto bueno de la anterior.
      review: reply === "justificada" ? "pendiente" : null,
      reviewNote: null,
      reviewedBy: null,
      reviewedAt: null,
    })
    .where(
      and(
        eq(messageRecipientsTable.messageId, id),
        eq(messageRecipientsTable.userId, req.session.userId!),
      ),
    )
    .returning();

  if (!updated) {
    res.status(404).json({ error: "No eres destinatarie de este mensaje" });
    return;
  }
  res.json(updated);
});

// ─── Administración ──────────────────────────────────────────────────────────

// Listado con el detalle de respuestas de cada destinatarie.
router.get("/admin/messages", requireAdmin, async (_req, res): Promise<void> => {
  const messages = await db
    .select({
      id: internalMessagesTable.id,
      subject: internalMessagesTable.subject,
      body: internalMessagesTable.body,
      kind: internalMessagesTable.kind,
      replyDeadline: internalMessagesTable.replyDeadline,
      createdAt: internalMessagesTable.createdAt,
      sessionId: internalMessagesTable.sessionId,
      sessionTitle: plenariasTable.title,
    })
    .from(internalMessagesTable)
    .leftJoin(plenariasTable, eq(internalMessagesTable.sessionId, plenariasTable.id))
    .orderBy(sql`${internalMessagesTable.createdAt} DESC`);

  if (messages.length === 0) {
    res.json([]);
    return;
  }

  const recipients = await db
    .select({
      messageId: messageRecipientsTable.messageId,
      userId: messageRecipientsTable.userId,
      name: usersTable.displayName,
      group: usersTable.group,
      faculty: usersTable.faculty,
      weight: usersTable.votingWeight,
      readAt: messageRecipientsTable.readAt,
      reply: messageRecipientsTable.reply,
      replyReason: messageRecipientsTable.replyReason,
      repliedAt: messageRecipientsTable.repliedAt,
      review: messageRecipientsTable.review,
      reviewNote: messageRecipientsTable.reviewNote,
    })
    .from(messageRecipientsTable)
    .innerJoin(usersTable, eq(messageRecipientsTable.userId, usersTable.id))
    .where(
      inArray(
        messageRecipientsTable.messageId,
        messages.map((m) => m.id),
      ),
    )
    .orderBy(usersTable.displayName);

  const byMessage = new Map<number, typeof recipients>();
  for (const r of recipients) {
    let arr = byMessage.get(r.messageId);
    if (!arr) byMessage.set(r.messageId, (arr = []));
    arr.push(r);
  }

  res.json(
    messages.map((m) => {
      const dest = byMessage.get(m.id) ?? [];
      const confirmadas = dest.filter((d) => esConfirmacion(d.reply));
      return {
        ...m,
        recipients: dest,
        total: dest.length,
        leidos: dest.filter((d) => d.readAt !== null).length,
        confirmadas: confirmadas.length,
        presenciales: dest.filter((d) => d.reply === "presencial").length,
        online: dest.filter((d) => d.reply === "online").length,
        justificadas: dest.filter((d) => d.reply === "justificada").length,
        sinResponder: dest.filter((d) => d.reply === null).length,
        pendientesRevision: dest.filter((d) => d.review === "pendiente").length,
        // Ponderación que se compromete a asistir. Es una proyección para
        // estimar el quórum antes de la sesión, nunca asistencia registrada.
        pesoConfirmado: confirmadas.reduce((s, d) => s + parseFloat(d.weight), 0),
      };
    }),
  );
});

// Enviar un mensaje.
router.post("/admin/messages", requireAdmin, async (req, res): Promise<void> => {
  const { subject, body, kind, sessionId, replyDeadline, userIds, groups } = req.body as {
    subject?: string;
    body?: string;
    kind?: string;
    sessionId?: number | null;
    replyDeadline?: string | null;
    userIds?: number[];
    groups?: string[];
  };

  if (!subject?.trim() || !body?.trim()) {
    res.status(400).json({ error: "Asunto y mensaje son obligatorios" });
    return;
  }
  const tipo: Kind = KINDS.includes(kind as Kind) ? (kind as Kind) : "informativo";

  // Destinatarios: por lista explícita, por estamento, o todo el pleno activo.
  let destinatarios: number[] = [];
  if (Array.isArray(userIds) && userIds.length > 0) {
    destinatarios = userIds;
  } else {
    const base = [eq(usersTable.rol, "miembro"), eq(usersTable.active, true)];
    const rows =
      Array.isArray(groups) && groups.length > 0
        ? await db
            .select({ id: usersTable.id })
            .from(usersTable)
            .where(and(...base, inArray(usersTable.group, groups)))
        : await db.select({ id: usersTable.id }).from(usersTable).where(and(...base));
    destinatarios = rows.map((r) => r.id);
  }

  if (destinatarios.length === 0) {
    res.status(400).json({ error: "No hay destinatarios" });
    return;
  }

  const [message] = await db
    .insert(internalMessagesTable)
    .values({
      subject: subject.trim(),
      body: body.trim(),
      kind: tipo,
      sessionId: sessionId ?? null,
      replyDeadline: replyDeadline ? new Date(replyDeadline) : null,
      createdBy: req.session.userId!,
    })
    .returning();

  await db.insert(messageRecipientsTable).values(
    destinatarios.map((userId) => ({ messageId: message.id, userId })),
  );

  res.status(201).json({ ...message, total: destinatarios.length });
});

// Resolver una justificación.
router.patch(
  "/admin/messages/:id/recipients/:userId",
  requireAdmin,
  async (req, res): Promise<void> => {
    const messageId = parseId(req.params.id);
    const userId = parseId(req.params.userId);
    if (messageId === null || userId === null) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const { review, note } = req.body as { review?: string; note?: string };
    if (review !== "aceptada" && review !== "rechazada") {
      res.status(400).json({ error: "Resolución inválida" });
      return;
    }

    const [updated] = await db
      .update(messageRecipientsTable)
      .set({
        review: review as Review,
        reviewNote: note?.trim() || null,
        reviewedBy: req.session.userId!,
        reviewedAt: new Date(),
      })
      .where(
        and(
          eq(messageRecipientsTable.messageId, messageId),
          eq(messageRecipientsTable.userId, userId),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Destinatarie no encontrade" });
      return;
    }

    // Aceptar una justificación deja la etiqueta "Inasistencia Justificada" en
    // el acta de esa sesión. No toca la asistencia: la persona sigue contando
    // como ausente para el quórum y no queda habilitada para votar.
    const [message] = await db
      .select()
      .from(internalMessagesTable)
      .where(eq(internalMessagesTable.id, messageId));

    if (message?.sessionId) {
      if (review === "aceptada") {
        await db
          .insert(justifiedAbsencesTable)
          .values({ sessionId: message.sessionId, userId })
          .onConflictDoNothing();
      } else {
        await db
          .delete(justifiedAbsencesTable)
          .where(
            and(
              eq(justifiedAbsencesTable.sessionId, message.sessionId),
              eq(justifiedAbsencesTable.userId, userId),
            ),
          );
      }
    }

    res.json(updated);
  },
);

export default router;
