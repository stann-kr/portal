"use client";

import { useCallback, useRef, useState } from "react";

export type LatestEditorContentReader = () => string;

/**
 * 에디터의 React 표시값과 실제 최신 문서 reader를 분리한다.
 * FullEditor가 지연 직렬화 중이어도 draft flush와 form submit은 reader로 최신 HTML을 얻는다.
 */
export function useDeferredEditorContent(initialContent: string) {
  const [contentHtml, setContentHtmlState] = useState(initialContent);
  const [contentVersion, setContentVersion] = useState(0);
  const fallbackContentRef = useRef(initialContent);
  const latestReaderRef = useRef<LatestEditorContentReader>(
    () => fallbackContentRef.current,
  );

  const setContentHtml = useCallback((html: string) => {
    fallbackContentRef.current = html;
    latestReaderRef.current = () => fallbackContentRef.current;
    setContentHtmlState(html);
    setContentVersion((version) => version + 1);
  }, []);

  const handleEditorChange = useCallback((html: string) => {
    fallbackContentRef.current = html;
    setContentHtmlState((current) => (current === html ? current : html));
  }, []);

  const handleEditorDirty = useCallback((reader: LatestEditorContentReader) => {
    latestReaderRef.current = reader;
  }, []);

  const readLatestContentHtml = useCallback(() => {
    const html = latestReaderRef.current();
    fallbackContentRef.current = html;
    return html;
  }, []);

  const commitLatestContentHtml = useCallback(() => {
    const html = readLatestContentHtml();
    setContentHtmlState((current) => (current === html ? current : html));
    return html;
  }, [readLatestContentHtml]);

  return {
    contentHtml,
    contentVersion,
    setContentHtml,
    handleEditorChange,
    handleEditorDirty,
    readLatestContentHtml,
    commitLatestContentHtml,
  };
}
