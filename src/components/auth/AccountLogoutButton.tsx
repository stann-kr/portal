"use client";

import { LogOut } from "lucide-react";
import { useFormStatus } from "react-dom";
import { logoutCurrentUser } from "@/lib/actions/session";
import { clearLocalDocumentDraftsForLogout } from "@/lib/local-draft-continuity-client";

function LogoutSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50"
      aria-label={pending ? "로그아웃 중" : "로그아웃"}
      title="로그아웃"
    >
      <LogOut className="size-4" aria-hidden="true" />
    </button>
  );
}

export function AccountLogoutButton({ ownerId }: { ownerId: string }) {
  return (
    <form
      action={logoutCurrentUser}
      onSubmit={() => {
        clearLocalDocumentDraftsForLogout(ownerId);
      }}
    >
      <LogoutSubmitButton />
    </form>
  );
}
