/**
 * @file src/components/digging/PlaylistSection.tsx
 * @description 디깅 보드 위 플레이리스트 목록(Beatport 공유·SoundCloud 세트 링크 카드).
 * - SoundCloud: "재생"으로 페이지 안 SoundCloud 위젯을 연다(한 번에 하나).
 * - Beatport: 외부 요청 없이 링크만 저장하고, 누르면 Beatport를 새 탭으로 연다.
 * - 학생 본인과 Stann(관리자, 학생 상세 디깅 탭): 추가·링크/제목/메모 수정·삭제(취소 우선 확인). 서버가 대상 학생을 다시 확인한다.
 * - 추가·수정 폼은 바뀐 내용이 있으면 Esc·취소에 버림 확인을 두고, 새로고침·탭 닫기는 브라우저 확인으로 막는다.
 */
"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { ExternalLink, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction, type ConfirmActionState } from "@/components/ui/confirm-action";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/section-header";
import { SoundCloudPlayer } from "@/components/player/SoundCloudPlayer";
import {
  createDiggingPlaylist,
  deleteDiggingPlaylist,
  updateDiggingPlaylist,
  type DiggingPlaylist,
} from "@/lib/actions/digging-playlists";
import {
  DIGGING_PLAYLIST_NOTE_MAX_LENGTH,
  DIGGING_PLAYLIST_TITLE_MAX_LENGTH,
  DIGGING_PLAYLIST_URL_MAX_LENGTH,
  diggingPlaylistDisplayTitle,
  normalizeDiggingPlaylistUrl,
  parseDiggingPlaylistNote,
  parseDiggingPlaylistTitle,
} from "@/lib/digging-contract";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { cn } from "@/lib/utils";

const PROVIDER_LABEL: Record<DiggingPlaylist["provider"], string> = {
  beatport: "Beatport",
  soundcloud: "SoundCloud",
};

const LABEL_CLASS = "text-ui font-semibold text-secondary-foreground";
const HINT_CLASS = "text-xs text-muted-foreground";
const TEXTAREA_CLASS =
  "w-full resize-y rounded-touch border border-input bg-background px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:opacity-50 aria-invalid:border-destructive-border md:rounded-md md:py-2 md:text-sm";
// 좁은 화면 44px 터치 대상, 넓은 화면 32px 아이콘 버튼.
const ROW_ACTION_CLASS =
  "flex size-11 shrink-0 items-center justify-center rounded-touch text-secondary-foreground transition-colors duration-[var(--duration-fast)] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 motion-reduce:transition-none md:size-8 md:rounded-md";
const TEXT_ACTION_CLASS =
  "inline-flex h-11 items-center gap-1.5 rounded-touch px-2 text-ui text-secondary-foreground transition-colors duration-[var(--duration-fast)] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:h-8 md:rounded-md";

interface PlaylistSectionProps {
  /** 플레이리스트 주인 학생. 모든 쓰기 action에 대상으로 넘긴다. */
  studentId: string;
  initialPlaylists: DiggingPlaylist[];
  /** 보는 사람에 따라 빈 목록 안내만 바꾼다. 편집 권한은 서버가 정한다. */
  viewer?: "student" | "admin";
}

export function PlaylistSection({ studentId, initialPlaylists, viewer = "student" }: PlaylistSectionProps) {
  const headingId = useId();
  const [playlists, setPlaylists] = useState<DiggingPlaylist[]>(initialPlaylists);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState("");
  const [isDeleting, startDelete] = useTransition();
  const deleteConfirm = useConfirmAction<string>();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  useBusyNavigationGuard(isDeleting);

  const focusEditButton = (playlistId: string) => {
    requestAnimationFrame(() => document.getElementById(`${headingId}-edit-${playlistId}`)?.focus());
  };

  const closeAddForm = () => {
    setAdding(false);
    // 닫힌 뒤 추가 버튼으로 초점을 돌려준다.
    requestAnimationFrame(() => addButtonRef.current?.focus());
  };

  const removePlaylist = (playlist: DiggingPlaylist) => {
    setMutationError("");
    startDelete(async () => {
      try {
        const result = await deleteDiggingPlaylist(studentId, playlist.id);
        if (!result.ok) {
          setMutationError(result.error);
          return;
        }
        setPlaylists((current) => current.filter((item) => item.id !== playlist.id));
        if (playingId === playlist.id) setPlayingId(null);
        // 지운 행의 버튼이 사라져 초점이 body로 떨어지지 않게 추가 버튼(폼이 열려 있으면 섹션)으로 옮긴다.
        requestAnimationFrame(() => (addButtonRef.current ?? sectionRef.current)?.focus());
      } catch {
        setMutationError("플레이리스트를 삭제하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  return (
    <section ref={sectionRef} tabIndex={-1} aria-labelledby={headingId} className="flex flex-col gap-3 outline-none">
      <SectionHeader
        title="플레이리스트"
        titleId={headingId}
        count={playlists.length}
        className="max-md:min-h-11 max-md:justify-center max-md:pb-0"
        action={!adding ? (
          <button
            ref={addButtonRef}
            type="button"
            onClick={() => { setAdding(true); setMutationError(""); }}
            className={TEXT_ACTION_CLASS}
          >
            <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
            플레이리스트 추가
          </button>
        ) : null}
      />

      {adding ? (
        <PlaylistCreateForm
          studentId={studentId}
          onCancel={closeAddForm}
          onCreated={(playlist) => {
            setPlaylists((current) => [playlist, ...current]);
            closeAddForm();
          }}
        />
      ) : null}

      {mutationError ? <p role="alert" className="text-ui text-destructive">{mutationError}</p> : null}

      {playlists.length === 0 ? (
        <p className="rounded-lg border border-muted px-4 py-8 text-center text-ui text-muted-foreground">
          {viewer === "admin"
            ? "아직 등록한 플레이리스트가 없습니다. 학생과 함께 들을 Beatport·SoundCloud 플레이리스트 링크를 추가할 수 있습니다."
            : "아직 등록한 플레이리스트가 없습니다. Beatport·SoundCloud 플레이리스트 링크를 추가해 Stann과 함께 들어 보세요."}
        </p>
      ) : (
        <ul className="flex flex-col">
          {playlists.map((playlist) => {
            const name = diggingPlaylistDisplayTitle(playlist);
            const playerId = `${headingId}-player-${playlist.id}`;
            const playing = playingId === playlist.id;
            const editing = editingId === playlist.id;
            return (
              <li key={playlist.id} className="flex flex-col gap-3 border-b border-muted py-3">
                {editing ? (
                  <PlaylistEditForm
                    studentId={studentId}
                    playlist={playlist}
                    onCancel={() => { setEditingId(null); focusEditButton(playlist.id); }}
                    onSaved={(saved) => {
                      setPlaylists((current) => current.map((item) => (item.id === saved.id ? saved : item)));
                      setEditingId(null);
                      focusEditButton(playlist.id);
                    }}
                  />
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="font-mono text-xs text-muted-foreground">{PROVIDER_LABEL[playlist.provider]}</span>
                      {playlist.provider === "beatport" ? (
                        <a
                          href={playlist.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-11 max-w-full items-center gap-1.5 self-start rounded-sm text-body font-medium text-foreground underline-offset-[3px] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
                        >
                          <span className="break-words">{name}</span>
                          <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                          <span className="sr-only">(새 탭에서 Beatport 열기)</span>
                        </a>
                      ) : (
                        <p className="break-words text-body font-medium text-foreground">{name}</p>
                      )}
                      {playlist.note ? (
                        <p className="whitespace-pre-wrap break-words text-ui text-secondary-foreground">{playlist.note}</p>
                      ) : null}
                      {playlist.provider === "soundcloud" ? (
                        <div className="-ml-2 flex flex-wrap items-center gap-1">
                          <button
                            type="button"
                            aria-expanded={playing}
                            aria-controls={playing ? playerId : undefined}
                            onClick={() => setPlayingId(playing ? null : playlist.id)}
                            className={TEXT_ACTION_CLASS}
                          >
                            {playing
                              ? <Square className="size-3 fill-current" strokeWidth={1.6} aria-hidden="true" />
                              : <Play className="size-3.5 fill-current" strokeWidth={1.6} aria-hidden="true" />}
                            {playing ? "플레이어 닫기" : "재생"}
                            <span className="sr-only">: {name}</span>
                          </button>
                          <a
                            href={playlist.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={TEXT_ACTION_CLASS}
                          >
                            SoundCloud에서 열기
                            <ExternalLink className="size-3" strokeWidth={1.8} aria-hidden="true" />
                            <span className="sr-only">(새 탭)</span>
                          </a>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center">
                      <button
                        id={`${headingId}-edit-${playlist.id}`}
                        type="button"
                        aria-label={`‘${name}’ 수정`}
                        onClick={() => { setEditingId(playlist.id); setMutationError(""); }}
                        disabled={isDeleting}
                        className={ROW_ACTION_CLASS}
                      >
                        <Pencil className="size-4 md:size-3.5" strokeWidth={1.6} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`‘${name}’ 삭제`}
                        onClick={(event) => deleteConfirm.request(event.currentTarget, playlist.id)}
                        disabled={isDeleting}
                        className={cn(ROW_ACTION_CLASS, "hover:text-destructive")}
                      >
                        <Trash2 className="size-4 md:size-3.5" strokeWidth={1.6} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                )}
                {deleteConfirm.value === playlist.id ? (
                  <ConfirmPanel
                    confirm={deleteConfirm}
                    message={`‘${name}’ 플레이리스트를 목록에서 삭제할까요? ${PROVIDER_LABEL[playlist.provider]}의 원래 플레이리스트는 그대로 남습니다.`}
                    confirmLabel="플레이리스트 삭제"
                    pendingLabel="삭제 중..."
                    pending={isDeleting}
                    onConfirm={() => removePlaylist(playlist)}
                  />
                ) : null}
                {playlist.provider === "soundcloud" && playing ? (
                  <div id={playerId}>
                    <SoundCloudPlayer url={playlist.url} title={`${name} SoundCloud 플레이어`} variant="playlist" />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PlaylistCreateForm({
  studentId,
  onCreated,
  onCancel,
}: {
  studentId: string;
  onCreated: (playlist: DiggingPlaylist) => void;
  onCancel: () => void;
}) {
  const formId = useId();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [urlError, setUrlError] = useState("");
  const [formError, setFormError] = useState("");
  const [isPending, startTransition] = useTransition();
  const urlRef = useRef<HTMLInputElement>(null);
  const discardConfirm = useConfirmAction();
  const dirty = url !== "" || title !== "" || note !== "";
  useBusyNavigationGuard(isPending);
  useUnsavedUnloadGuard(dirty && !isPending);

  useEffect(() => { urlRef.current?.focus(); }, []);

  const requestClose = (trigger: HTMLElement | null) => {
    if (dirty) discardConfirm.request(trigger);
    else onCancel();
  };

  const detected = normalizeDiggingPlaylistUrl(url);
  const titleHint = detected.ok && detected.provider === "soundcloud"
    ? "비워 두면 SoundCloud에서 제목을 가져옵니다."
    : detected.ok && detected.provider === "beatport"
      ? "비워 두면 ‘Beatport 플레이리스트’로 표시합니다."
      : "선택 사항입니다. SoundCloud는 비워 두면 제목을 가져옵니다.";

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (isPending) return;
    setFormError("");
    const normalized = normalizeDiggingPlaylistUrl(url);
    if (!normalized.ok) {
      setUrlError(normalized.error);
      urlRef.current?.focus();
      return;
    }
    const parsedTitle = parseDiggingPlaylistTitle(title);
    const parsedNote = parseDiggingPlaylistNote(note);
    if (!parsedTitle.ok || !parsedNote.ok) {
      setFormError(!parsedTitle.ok ? parsedTitle.error : !parsedNote.ok ? parsedNote.error : "");
      return;
    }
    setUrlError("");
    startTransition(async () => {
      try {
        const result = await createDiggingPlaylist(studentId, { url: normalized.url, title: parsedTitle.value, note: parsedNote.value });
        if (!result.ok) {
          setFormError(result.error);
          return;
        }
        onCreated(result.playlist);
      } catch {
        setFormError("플레이리스트를 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
      }
    });
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-busy={isPending}
      aria-label="플레이리스트 추가"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !isPending) {
          event.preventDefault();
          requestClose(event.target instanceof HTMLElement ? event.target : null);
        }
      }}
      className="flex flex-col gap-4 rounded-lg border border-border px-4 py-4 md:px-5"
    >
      {formError ? (
        <p role="alert" className="rounded-md bg-destructive-muted px-3 py-2 text-ui text-destructive">{formError}</p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-url`} className={LABEL_CLASS}>플레이리스트 링크</label>
        <Input
          ref={urlRef}
          id={`${formId}-url`}
          type="url"
          inputMode="url"
          autoComplete="off"
          required
          maxLength={DIGGING_PLAYLIST_URL_MAX_LENGTH}
          placeholder="https://www.beatport.com/playlists/share/…"
          value={url}
          onChange={(event) => { setUrl(event.target.value); setUrlError(""); }}
          disabled={isPending}
          aria-invalid={urlError ? true : undefined}
          aria-describedby={`${formId}-url-hint${urlError ? ` ${formId}-url-error` : ""}`}
        />
        <p id={`${formId}-url-hint`} className={HINT_CLASS}>
          Beatport 공유 링크(beatport.com/playlists/share/…) 또는 SoundCloud 플레이리스트 링크(soundcloud.com/…/sets/…)
        </p>
        {urlError ? <p id={`${formId}-url-error`} className="text-xs text-destructive">{urlError}</p> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-title`} className={LABEL_CLASS}>제목 <span className="font-normal text-muted-foreground">(선택)</span></label>
        <Input
          id={`${formId}-title`}
          maxLength={DIGGING_PLAYLIST_TITLE_MAX_LENGTH}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={isPending}
          aria-describedby={`${formId}-title-hint`}
        />
        <p id={`${formId}-title-hint`} className={HINT_CLASS}>{titleHint}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-note`} className={LABEL_CLASS}>메모 <span className="font-normal text-muted-foreground">(선택)</span></label>
        <textarea
          id={`${formId}-note`}
          rows={3}
          maxLength={DIGGING_PLAYLIST_NOTE_MAX_LENGTH}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={isPending}
          className={TEXTAREA_CLASS}
        />
      </div>
      {discardConfirm.isOpen ? <DiscardConfirmPanel confirm={discardConfirm} onConfirm={onCancel} /> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={(event) => requestClose(event.currentTarget)} disabled={isPending} className="h-11 md:h-8">
          취소
        </Button>
        <Button type="submit" pending={isPending} className="h-11 md:h-8">
          {isPending ? "저장 중..." : "추가"}
        </Button>
      </div>
    </form>
  );
}

function PlaylistEditForm({
  studentId,
  playlist,
  onSaved,
  onCancel,
}: {
  studentId: string;
  playlist: DiggingPlaylist;
  onSaved: (playlist: DiggingPlaylist) => void;
  onCancel: () => void;
}) {
  const formId = useId();
  const initialTitle = playlist.title ?? "";
  const initialNote = playlist.note ?? "";
  const [url, setUrl] = useState(playlist.url);
  const [title, setTitle] = useState(initialTitle);
  const [note, setNote] = useState(initialNote);
  const [urlError, setUrlError] = useState("");
  const [formError, setFormError] = useState("");
  const [isPending, startTransition] = useTransition();
  const urlRef = useRef<HTMLInputElement>(null);
  const discardConfirm = useConfirmAction();
  const dirty = url !== playlist.url || title !== initialTitle || note !== initialNote;
  useBusyNavigationGuard(isPending);
  useUnsavedUnloadGuard(dirty && !isPending);

  useEffect(() => { urlRef.current?.focus(); }, []);

  const requestClose = (trigger: HTMLElement | null) => {
    if (dirty) discardConfirm.request(trigger);
    else onCancel();
  };

  const detected = normalizeDiggingPlaylistUrl(url);
  const provider = detected.ok ? detected.provider : playlist.provider;
  const defaultTitle = diggingPlaylistDisplayTitle({ provider, title: null });
  const urlChanged = detected.ok && detected.url !== playlist.url;
  const titleHint = urlChanged && provider === "soundcloud"
    ? "비워 두면 SoundCloud에서 제목을 가져옵니다."
    : `비워 두면 ‘${defaultTitle}’로 표시합니다.`;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (isPending) return;
    setFormError("");
    const normalized = normalizeDiggingPlaylistUrl(url);
    if (!normalized.ok) {
      setUrlError(normalized.error);
      urlRef.current?.focus();
      return;
    }
    const parsedTitle = parseDiggingPlaylistTitle(title);
    const parsedNote = parseDiggingPlaylistNote(note);
    if (!parsedTitle.ok || !parsedNote.ok) {
      setFormError(!parsedTitle.ok ? parsedTitle.error : !parsedNote.ok ? parsedNote.error : "");
      return;
    }
    setUrlError("");
    startTransition(async () => {
      try {
        const result = await updateDiggingPlaylist(studentId, playlist.id, {
          url: normalized.url,
          title: parsedTitle.value,
          note: parsedNote.value,
          // 폼을 연 시점의 행과 비교해, 그 사이 학생·Stann 중 다른 쪽이 고쳤으면 덮지 않는다.
          expectedUpdatedAt: new Date(playlist.updatedAt).getTime(),
        });
        if (!result.ok) {
          setFormError(result.error);
          return;
        }
        onSaved(result.playlist);
      } catch {
        setFormError("플레이리스트를 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
      }
    });
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-busy={isPending}
      aria-label={`‘${diggingPlaylistDisplayTitle(playlist)}’ 수정`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !isPending) {
          event.preventDefault();
          requestClose(event.target instanceof HTMLElement ? event.target : null);
        }
      }}
      className="flex flex-col gap-4"
    >
      <p className="font-mono text-xs text-muted-foreground">{PROVIDER_LABEL[provider]}</p>
      {formError ? (
        <p role="alert" className="rounded-md bg-destructive-muted px-3 py-2 text-ui text-destructive">{formError}</p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-url`} className={LABEL_CLASS}>플레이리스트 링크</label>
        <Input
          ref={urlRef}
          id={`${formId}-url`}
          type="url"
          inputMode="url"
          autoComplete="off"
          required
          maxLength={DIGGING_PLAYLIST_URL_MAX_LENGTH}
          value={url}
          onChange={(event) => { setUrl(event.target.value); setUrlError(""); }}
          disabled={isPending}
          aria-invalid={urlError ? true : undefined}
          aria-describedby={`${formId}-url-hint${urlError ? ` ${formId}-url-error` : ""}`}
        />
        <p id={`${formId}-url-hint`} className={HINT_CLASS}>
          Beatport 공유 링크(beatport.com/playlists/share/…) 또는 SoundCloud 플레이리스트 링크(soundcloud.com/…/sets/…)
        </p>
        {urlError ? <p id={`${formId}-url-error`} className="text-xs text-destructive">{urlError}</p> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-title`} className={LABEL_CLASS}>제목</label>
        <Input
          id={`${formId}-title`}
          maxLength={DIGGING_PLAYLIST_TITLE_MAX_LENGTH}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={defaultTitle}
          disabled={isPending}
          aria-describedby={`${formId}-title-hint`}
        />
        <p id={`${formId}-title-hint`} className={HINT_CLASS}>{titleHint}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-note`} className={LABEL_CLASS}>메모</label>
        <textarea
          id={`${formId}-note`}
          rows={3}
          maxLength={DIGGING_PLAYLIST_NOTE_MAX_LENGTH}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={isPending}
          className={TEXTAREA_CLASS}
        />
      </div>
      {discardConfirm.isOpen ? <DiscardConfirmPanel confirm={discardConfirm} onConfirm={onCancel} /> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={(event) => requestClose(event.currentTarget)} disabled={isPending} className="h-11 md:h-8">
          취소
        </Button>
        <Button type="submit" pending={isPending} className="h-11 md:h-8">
          {isPending ? "저장 중..." : "저장"}
        </Button>
      </div>
    </form>
  );
}

/** 바뀐 내용이 있는 폼을 닫기 전 확인(취소 우선). */
function DiscardConfirmPanel({
  confirm,
  onConfirm,
}: {
  confirm: Pick<ConfirmActionState<unknown>, "close">;
  onConfirm: () => void;
}) {
  return (
    <ConfirmPanel
      confirm={confirm}
      message="작성 중인 내용이 있습니다. 저장하지 않고 닫을까요?"
      confirmLabel="저장하지 않고 닫기"
      onConfirm={onConfirm}
    />
  );
}

/** 저장하지 않은 입력이 있으면 새로고침·탭 닫기·외부 이동에 브라우저 확인을 띄운다. */
function useUnsavedUnloadGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);
}
