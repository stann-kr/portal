import {
  BookOpen,
  CalendarDays,
  FileVideo,
  House,
  Inbox,
  type LucideIcon,
  Megaphone,
  MessageCircleQuestion,
  MessagesSquare,
  Music2,
  NotebookPen,
  Settings2,
  Users,
} from "lucide-react";

export type AppRole = "admin" | "student";

export type AppNavItem = {
  id: string;
  label: string;
  href: string;
  Icon: LucideIcon;
};

/**
 * 사이드바 메뉴. 같은 포털 화면의 구역은 `?section=`·`?view=` 주소로 표현해
 * 새로고침·뒤로가기·공유가 같은 위치를 연다.
 */
export const APP_NAV_ITEMS: Record<AppRole, readonly AppNavItem[]> = {
  student: [
    { id: "today", label: "홈", href: "/dashboard/student?section=today", Icon: House },
    { id: "calendar", label: "캘린더", href: "/dashboard/student?section=workspace&view=calendar", Icon: CalendarDays },
    { id: "notes", label: "노트", href: "/dashboard/student/notes", Icon: NotebookPen },
    { id: "assignments", label: "과제", href: "/dashboard/student?section=workspace&view=assignments", Icon: FileVideo },
    { id: "curriculum", label: "커리큘럼", href: "/dashboard/student?section=workspace&view=curriculum", Icon: BookOpen },
    { id: "digging", label: "디깅", href: "/dashboard/student/digging", Icon: Music2 },
    { id: "qna", label: "Q&A", href: "/dashboard/qna", Icon: MessageCircleQuestion },
    { id: "community", label: "커뮤니티", href: "/community", Icon: MessagesSquare },
  ],
  admin: [
    { id: "work", label: "업무함", href: "/dashboard/admin?section=work", Icon: Inbox },
    { id: "students", label: "학생", href: "/dashboard/admin?section=students", Icon: Users },
    { id: "schedule", label: "일정", href: "/dashboard/admin?section=schedule", Icon: CalendarDays },
    { id: "announcements", label: "공지", href: "/dashboard/admin?section=announcements", Icon: Megaphone },
    { id: "qna", label: "Q&A", href: "/dashboard/qna", Icon: MessageCircleQuestion },
    { id: "community", label: "커뮤니티", href: "/community", Icon: MessagesSquare },
    { id: "operations", label: "운영 도구", href: "/dashboard/admin/operations", Icon: Settings2 },
  ],
};

type Location = { pathname: string; searchParams: URLSearchParams };

/** 현재 주소가 어느 메뉴에 속하는지 정한다. 상세·작성·휴지통 화면도 상위 메뉴를 표시한다. */
export function resolveActiveNavItem(role: AppRole, { pathname, searchParams }: Location): string | null {
  const section = searchParams.get("section");
  if (role === "student") {
    if (pathname === "/dashboard/student") {
      if (section === "workspace") {
        const view = searchParams.get("view") ?? "calendar";
        // 달력·일별·전체 보기는 모두 캘린더 메뉴다.
        return view === "assignments" || view === "curriculum" ? view : "calendar";
      }
      if (section === "community") return "community";
      return "today";
    }
    if (pathname.startsWith("/dashboard/student/notes") || pathname.startsWith("/dashboard/notes")) return "notes";
    if (pathname.startsWith("/dashboard/student/assignments")) return "assignments";
    if (pathname.startsWith("/dashboard/student/digging")) return "digging";
  } else {
    if (pathname === "/dashboard/admin") {
      const ids = ["work", "students", "schedule", "announcements"];
      if (section && ids.includes(section)) return section;
      if (section === "community") return "community";
      return "work";
    }
    if (pathname.startsWith("/dashboard/admin/students") || pathname.startsWith("/dashboard/notes")) return "students";
    if (pathname.startsWith("/dashboard/admin/operations") || pathname.startsWith("/dashboard/admin/categories")) {
      return "operations";
    }
  }
  if (pathname.startsWith("/dashboard/qna")) return "qna";
  if (pathname.startsWith("/community")) return "community";
  return null;
}

/**
 * 같은 포털 화면 안의 구역 이동은 서버를 다시 부르지 않는다. 주소만 바꾸고 popstate를 보내면
 * 포털 구역과 워크스페이스 보기가 각자 주소를 다시 읽는다.
 */
export function navigateWithinPage(href: string): boolean {
  const target = new URL(href, window.location.href);
  if (target.pathname !== window.location.pathname) return false;
  if (`${target.pathname}${target.search}` !== `${window.location.pathname}${window.location.search}`) {
    window.history.pushState(window.history.state, "", `${target.pathname}${target.search}${target.hash}`);
  }
  window.dispatchEvent(new window.PopStateEvent("popstate", { state: window.history.state }));
  return true;
}
