import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import membersRouter from "./members";
import sessionsRouter from "./sessions";
import attendanceRouter from "./attendance";
import agendaRouter from "./agenda";
import speakingRouter from "./speaking";
import topicsRouter from "./topics";
import votesRouter from "./votes";
import historyRouter from "./history";
import adminRouter from "./admin";
import storageRouter from "./storage";
import unidadesRouter from "./unidades";
import messagesRouter from "./messages";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(membersRouter);
router.use(sessionsRouter);
router.use(attendanceRouter);
router.use(agendaRouter);
router.use(speakingRouter);
router.use(topicsRouter);
router.use(votesRouter);
router.use(historyRouter);
router.use(adminRouter);
router.use(storageRouter);
router.use(unidadesRouter);
router.use(messagesRouter);

export default router;
