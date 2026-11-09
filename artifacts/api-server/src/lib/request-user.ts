import { usersTable } from "@workspace/db";

export const requestUserColumns = {
  id: usersTable.id,
  username: usersTable.username,
  displayName: usersTable.displayName,
  group: usersTable.group,
  faculty: usersTable.faculty,
  email: usersTable.email,
  votingWeight: usersTable.votingWeight,
  rol: usersTable.rol,
  active: usersTable.active,
  mustChangePassword: usersTable.mustChangePassword,
};

export type RequestUser = Pick<typeof usersTable.$inferSelect, keyof typeof requestUserColumns>;
