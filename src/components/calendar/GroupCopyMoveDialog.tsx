"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 관리자가 학생 일정에서 그룹 캘린더 일정의 사본을 끌어 옮기거나 길이를 바꾼 직후, 저장하기 전에 묻는다
 * (캔버스 Decisions1121 ①, 2026-11-21 사용자 결정). 옮기면 그 학생 사본만 그룹 원본에서 떼어진다.
 * 취소·Esc·바깥 누르기는 모두 `onCancel`(일정을 제자리로)이고, 확인은 `onConfirm`만 부른다.
 */
export function GroupCopyMoveDialog({
  open,
  studentName,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  studentName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}>
      <DialogContent
        className="md:max-w-[400px]"
        onOpenAutoFocus={(event) => {
          // 되돌리기 어려운 쪽이 확인이라 취소에 먼저 초점을 둔다.
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>이 학생 일정만 옮길까요?</DialogTitle>
          <DialogDescription>
            이 일정은 그룹 캘린더 일정의 사본입니다. 옮기면 {studentName} 일정만 그룹 일정에서 떼어지고, 다른 멤버 일정과 그룹 원본은 그대로입니다. 그 뒤 그룹 캘린더에서 원본을 고쳐도 이 일정에는 반영되지 않습니다.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            size="touch"
            className="md:h-8 md:rounded-md md:px-3.5 md:text-ui"
            onClick={onCancel}
          >
            취소
          </Button>
          <Button
            type="button"
            size="touch"
            className="md:h-8 md:rounded-md md:px-3.5 md:text-ui"
            onClick={onConfirm}
          >
            이 학생 일정만 옮기기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
