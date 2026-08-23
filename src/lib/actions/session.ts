"use server";

import { signOut } from "@/auth";

export async function logoutCurrentUser(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
