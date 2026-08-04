import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { auth } from "@/auth";
import { getPrivateNote, updatePrivateNote } from "@/lib/actions/privateNotes";
import { safeReturnPath } from "@/lib/safe-return-path";
import { NoteEditorForm } from "@/components/notes/NoteEditorForm";
import { RichTextContent } from "@/components/editor/RichTextContent";

export const metadata = { title: "노트" };

export default async function NotePage({
  params,
  searchParams,
}: {
  params: Promise<{ noteId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { noteId } = await params;
  const note = await getPrivateNote(noteId);
  if (!note) notFound();

  const fallback = session.user.role === "admin" ? "/dashboard/admin" : "/dashboard/student";
  const { returnTo: requestedReturnTo } = await searchParams;
  const returnTo = safeReturnPath(requestedReturnTo, fallback);
  const canEdit = session.user.role === "admin" || session.user.id === note.authorId;
  const action = updatePrivateNote.bind(null, note.id);

  return (
    <article className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-3 border-b border-border pb-5">
        <Link
          href={returnTo}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          이전 작업으로 돌아가기
        </Link>
        <div>
          <p className="text-xs text-muted-foreground">
            {note.authorName ?? "작성자 미상"} · {new Date(note.noteDate ?? note.createdAt ?? Date.now()).toLocaleDateString("ko-KR")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{note.title}</h1>
        </div>
      </header>

      {canEdit ? (
        <NoteEditorForm
          note={{
            id: note.id,
            title: note.title,
            contentHtml: note.contentHtml,
            noteDate: note.noteDate,
          }}
          actorId={session.user.id}
          action={action}
        />
      ) : (
        <section className="space-y-4">
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
            다른 작성자의 노트는 읽기 전용입니다.
          </p>
          <RichTextContent html={note.contentHtml} />
        </section>
      )}
    </article>
  );
}
