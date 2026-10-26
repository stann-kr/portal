import {
  BookOpen,
  CalendarDays,
  CircleHelp,
  FilePlay,
  FileText,
  House,
  Inbox,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  Music,
  SlidersVertical,
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
    { id: "notes", label: "노트", href: "/dashboard/student/notes", Icon: FileText },
    { id: "assignments", label: "과제", href: "/dashboard/student?section=workspace&view=assignments", Icon: FilePlay },
    { id: "curriculum", label: "커리큘럼", href: "/dashboard/student?section=workspace&view=curriculum", Icon: BookOpen },
    { id: "digging", label: "디깅", href: "/dashboard/student/digging", Icon: Music },
    { id: "qna", label: "Q&A", href: "/dashboard/qna", Icon: CircleHelp },
    { id: "community", label: "커뮤니티", href: "/community", Icon: MessageSquare },
  ],
  admin: [
    { id: "work", label: "업무함", href: "/dashboard/admin?section=work", Icon: Inbox },
    { id: "students", label: "학생", href: "/dashboard/admin?section=students", Icon: Users },
    { id: "schedule", label: "일정", href: "/dashboard/admin?section=schedule", Icon: CalendarDays },
    { id: "announcements", label: "공지", href: "/dashboard/admin?section=announcements", Icon: Megaphone },
    { id: "qna", label: "Q&A", href: "/dashboard/qna", Icon: CircleHelp },
    { id: "community", label: "커뮤니티", href: "/community", Icon: MessageSquare },
    { id: "operations", label: "운영 도구", href: "/dashboard/admin/operations", Icon: SlidersVertical },
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

/** 좁은 화면 위쪽 막대(MobileSpec): 왼쪽은 메뉴 또는 뒤로, 가운데 제목, 오른쪽은 화면의 주 행동. */
export type MobileTopBarConfig = {
  title: string;
  back?: { href: string; label: string };
  action?: { href: string; label: string };
};

const STUDENT_NOTES_HREF = "/dashboard/student/notes";
const STUDENT_CALENDAR_HREF = "/dashboard/student?section=workspace&view=calendar";
const ADMIN_STUDENTS_HREF = "/dashboard/admin?section=students";

/** 빠른 만들기 시트를 오늘 날짜로 연다(캘린더가 `create` 주소 값을 읽는다). */
export function quickCreateHref(base: string): string {
  return `${base}${base.includes("?") ? "&" : "?"}create=today`;
}

/** 주소에서 위쪽 막대의 기본값을 정한다. 화면이 더 정확한 제목·행동을 가지면 MobileTopBar로 덮어쓴다. */
export function resolveMobileTopBar(role: AppRole, location: Location): MobileTopBarConfig {
  const { pathname, searchParams } = location;
  const section = searchParams.get("section");
  const navLabel = (id: string | null) => APP_NAV_ITEMS[role].find((item) => item.id === id)?.label ?? "Stann Lumo";

  if (pathname.startsWith("/dashboard/qna")) {
    const back = { href: "/dashboard/qna", label: "Q&A 목록으로" };
    if (pathname === "/dashboard/qna") return { title: "Q&A", action: role === "student" ? { href: "/dashboard/qna/new", label: "새 질문" } : undefined };
    if (pathname === "/dashboard/qna/new") return { title: "새 질문 작성", back };
    if (pathname === "/dashboard/qna/trash") return { title: "휴지통", back };
    return { title: "Q&A", back };
  }
  if (pathname.startsWith("/community")) {
    const back = { href: "/community", label: "커뮤니티 목록으로" };
    if (pathname === "/community") return { title: "커뮤니티", action: { href: "/community/new", label: "새 글" } };
    if (pathname === "/community/new") return { title: "새 게시물", back };
    if (pathname === "/community/trash") return { title: "휴지통", back };
    return { title: "커뮤니티", back };
  }

  if (role === "student") {
    if (pathname === "/dashboard/student") {
      const active = resolveActiveNavItem(role, location);
      if (active === "calendar") return { title: "캘린더", action: { href: quickCreateHref(STUDENT_CALENDAR_HREF), label: "새로 만들기" } };
      if (active === "today") return { title: "홈", action: { href: quickCreateHref(STUDENT_CALENDAR_HREF), label: "새로 만들기" } };
      return { title: navLabel(active) };
    }
    if (pathname === STUDENT_NOTES_HREF) return { title: "노트", action: { href: `${STUDENT_NOTES_HREF}/new`, label: "새 노트" } };
    if (pathname.startsWith("/dashboard/student/notes") || pathname.startsWith("/dashboard/notes")) {
      return { title: "노트", back: { href: STUDENT_NOTES_HREF, label: "노트 목록으로" } };
    }
    if (pathname.startsWith("/dashboard/student/assignments/")) {
      return { title: "과제", back: { href: "/dashboard/student?section=workspace&view=assignments", label: "과제 목록으로" } };
    }
    if (pathname.startsWith("/dashboard/student/digging")) return { title: "디깅 보드" };
    return { title: navLabel(resolveActiveNavItem(role, location)) };
  }

  if (pathname === "/dashboard/admin") {
    const active = resolveActiveNavItem(role, location);
    if (active === "work" || active === "schedule") {
      return { title: navLabel(active), action: { href: "/dashboard/admin?section=schedule&create=lesson", label: "레슨 예약" } };
    }
    if (active === "students") return { title: "학생", action: { href: "/dashboard/admin/students/new", label: "수강생 추가" } };
    if (active === "announcements" || section === "announcements") {
      return { title: "공지", action: { href: "/dashboard/admin?section=announcements&compose=1", label: "공지 작성" } };
    }
    return { title: navLabel(active) };
  }
  if (pathname === "/dashboard/admin/students/new") return { title: "수강생 추가", back: { href: ADMIN_STUDENTS_HREF, label: "학생 목록으로" } };
  if (pathname.startsWith("/dashboard/admin/students/") || pathname.startsWith("/dashboard/notes")) {
    return { title: "학생", back: { href: ADMIN_STUDENTS_HREF, label: "학생 목록으로" } };
  }
  if (pathname.startsWith("/dashboard/admin/categories")) {
    return { title: "커뮤니티 채널", back: { href: "/community", label: "커뮤니티로 돌아가기" } };
  }
  return { title: navLabel(resolveActiveNavItem(role, location)) };
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
