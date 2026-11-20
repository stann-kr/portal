/**
 * 수강 종료한 학생(캔버스 StudentArchive ②·③). 학생 목록 맨 아래 링크로 온다. 사이드바는 '학생'이다.
 * 수강 종료한 학생은 로그인·목록·선택지에서 빠져 있고, 여기서만 보이며 바로 복원할 수 있다.
 * 이름을 누르면 복원하지 않고 기록을 읽는 보기 전용 상세로 간다(캔버스 UxReview1120Policies ⑩).
 */
import { redirect } from "next/navigation";
import { getArchivedStudents } from "@/lib/actions/students";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { formatKstDot } from "@/lib/kst-format";
import { getRequestNow } from "@/lib/request-time";
import { ArchivedStudentsClient, type ArchivedStudentRow } from "./ArchivedStudentsClient";

export const metadata = { title: "수강 종료한 학생" };

export default async function ArchivedStudentsPage() {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard/student");

  const now = new Date(getRequestNow());
  const rows: ArchivedStudentRow[] = (await getArchivedStudents()).map((student) => ({
    id: student.id,
    name: student.displayName?.trim() || student.email,
    email: student.email,
    // 올해면 "11.18", 다른 해면 연도까지(서버에서 만들어 hydration 차이를 피한다).
    archivedLabel: student.archivedAt ? formatKstDot(student.archivedAt, { referenceTime: now }) : "–",
  }));

  return (
    <div className="px-5 pb-8 pt-4 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      <ArchivedStudentsClient students={rows} />
    </div>
  );
}
