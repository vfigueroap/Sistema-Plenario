import bcrypt from "bcryptjs";
import { setImmediate } from "node:timers/promises";

const MAX_ACTIVE = 2;
const MAX_QUEUED = 512;
let active = 0;
const queue: (() => void)[] = [];

export class PasswordQueueFullError extends Error {}

export async function checkPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  if (active >= MAX_ACTIVE) {
    if (queue.length >= MAX_QUEUED) throw new PasswordQueueFullError();
    await new Promise<void>((resolve) => queue.push(resolve));
  } else {
    active++;
  }
  try {
    await setImmediate();
    return await bcrypt.compare(password, hash);
  } finally {
    const next = queue.shift();
    if (next) next();
    else active--;
  }
}
