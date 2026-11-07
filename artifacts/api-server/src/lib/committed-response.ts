import type { Response } from "express";

export function committedResponse(res: Response) {
  const originalEnd = res.end;
  let pending: Parameters<Response["end"]> | undefined;
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  void ready.catch(() => {});
  const finish = () =>
    res.statusCode >= 500
      ? readyReject(new Error("Request failed"))
      : readyResolve();
  const close = () => {
    if (!res.writableEnded) readyReject(new Error("Request aborted"));
  };
  res.once("finish", finish);
  res.once("close", close);
  res.end = function (this: Response, ...args: Parameters<Response["end"]>) {
    if (res.headersSent) return originalEnd.apply(this, args);
    pending = args;
    finish();
    return this;
  } as Response["end"];
  const restore = () => {
    res.end = originalEnd;
    res.off("finish", finish);
    res.off("close", close);
  };
  return {
    ready,
    send() {
      restore();
      if (pending && !res.destroyed) originalEnd.apply(res, pending);
    },
    fail() {
      restore();
      if (res.destroyed || res.headersSent) return;
      res.removeHeader("Content-Length");
      res.removeHeader("ETag");
      res.status(500).setHeader("Cache-Control", "no-store");
      res.json({
        error:
          "No se pudo confirmar la operación. Actualiza antes de intentar de nuevo.",
      });
    },
  };
}
