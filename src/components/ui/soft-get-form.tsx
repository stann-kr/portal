"use client";

import type { ComponentPropsWithoutRef } from "react";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";

/** 제출한 form 값(누른 버튼의 name·value 포함)으로 이동할 주소를 만든다. 파일 칸은 이름만(브라우저 GET form과 같다). */
export function softGetFormHref(form: HTMLFormElement, submitter: HTMLElement | null, base: string): string {
  const target = new URL(form.getAttribute("action") || base, base);
  // GET form은 action 주소의 query를 form 값으로 바꾼다(HTML 규칙). hash는 남긴다.
  target.search = "";
  let data: FormData;
  try {
    data = submitter ? new FormData(form, submitter) : new FormData(form);
  } catch {
    // FormData(form, submitter)를 모르는 예전 브라우저(Safari 16.3 이하 등)는 누른 버튼 값을 직접 더한다.
    data = new FormData(form);
  }
  const submitterName = submitter?.getAttribute("name");
  if (submitter && submitterName && !data.has(submitterName)) {
    data.append(submitterName, submitter.getAttribute("value") ?? "");
  }
  for (const [name, value] of data) {
    target.searchParams.append(name, typeof value === "string" ? value : value.name);
  }
  return `${target.pathname}${target.search}${target.hash}`;
}

/**
 * 주소로 검색·필터하는 GET form을 문서 이동 대신 앱 안 이동으로 보낸다(Q&A 상태 탭·검색, 노트·커뮤니티 검색).
 * 일반 `<form method="get">`은 전체 페이지를 다시 받아 셸까지 새로 그렸다(스켈레톤 대신 흰/검은 화면과 위쪽 막대 없음).
 * JS가 없을 때는 그대로 문서 이동으로 동작한다.
 */
export function SoftGetForm({ onSubmit, ...props }: Omit<ComponentPropsWithoutRef<"form">, "method"> & { action: string }) {
  const router = useProgressRouter();
  const handleSubmit: NonNullable<ComponentPropsWithoutRef<"form">["onSubmit"]> = (event) => {
    onSubmit?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    const submitter = (event.nativeEvent as unknown as { submitter?: HTMLElement | null }).submitter ?? null;
    const href = softGetFormHref(event.currentTarget, submitter, window.location.href);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (href === current) return;
    // useProgressRouter.push가 위쪽 이동 막대를 켠다.
    router.push(href);
  };
  return <form {...props} method="get" onSubmit={handleSubmit} />;
}
