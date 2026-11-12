import type { Metadata } from "next";
import Link from "next/link";
import { Instagram } from "lucide-react";
import { PortalLogoMark } from "@/components/brand/PortalLogoMark";
import { cn } from "@/lib/utils";

/**
 * @file src/app/lesson/page.tsx
 * @description 로그인 없이 여는 신규 레슨 상담 안내(캔버스 LessonInfo·MobileLessonInfo). 인스타그램 DM 상담 양식의
 * 레슨 안내·과정과 비용·수업 방식과 단계별 커리큘럼을 담는다. 내용을 바꾸면 캔버스 보드도 함께 고친다.
 */

export const metadata: Metadata = {
  title: "DJ 레슨 안내",
  description: "테크노·하우스 DJ Stann Lumo의 1:1 디제잉 레슨. 과정과 비용, 수업 방식, 커리큘럼과 상담 안내.",
};

const INSTAGRAM_HANDLE = "stannlumo";
const INSTAGRAM_DM_URL = `https://ig.me/m/${INSTAGRAM_HANDLE}`;
const INSTAGRAM_PROFILE_URL = `https://www.instagram.com/${INSTAGRAM_HANDLE}/`;

const FACTS = [
  { label: "장르", value: "테크노, 하우스" },
  { label: "장소", value: "이태원 파우스트 내부 탄즈바" },
  { label: "일정", value: "주 1회 고정 요일 · 공유 캘린더로 조율" },
] as const;

const COURSES = [
  {
    name: "정규 과정",
    length: "회당 1시간 30분",
    price: "32만 원",
    desc: "보다 깊이 있게 배우고 싶은 분. 믹싱 기술부터 셋 구성, 실전 노하우까지 충분한 시간을 두고 다룹니다.",
    featured: true,
  },
  {
    name: "취미 과정",
    length: "회당 1시간",
    price: "27만 원",
    desc: "취미로 가볍게 시작하고 싶은 분. 장비와 기본 믹싱을 익히며 좋아하는 음악을 직접 이어 봅니다.",
    featured: false,
  },
] as const;

const METHODS = [
  {
    title: "수준과 목표에 맞춘 1:1 수업",
    body: "디제잉을 처음 시작하는 분부터 클럽 데뷔를 준비하는 분까지, 정해진 커리큘럼을 일괄적으로 따르기보다 경험과 관심사에 맞춰 수업을 구성합니다.",
  },
  {
    title: "레슨 전용 포털로 진도 관리",
    body: "자체 레슨 LMS에서 수업 노트와 피드백, 과제, 일정, 공용 가이드를 확인합니다. 수업이 끝난 뒤에도 배운 내용을 다시 볼 수 있습니다.",
  },
  {
    title: "실제 클럽 장비와 환경",
    body: "파우스트 탄즈바에서 클럽 장비로 수업합니다. 장비를 처음 다뤄도 기초부터 차근차근 시작해 스스로 믹스를 구성하고 완성할 수 있도록 함께합니다.",
  },
] as const;

const STAGES = [
  { title: "디깅과 음원 관리", goal: "틀고 싶은 음악을 직접 찾고, 언제든 꺼내 쓸 수 있게 정리하는 단계", topics: ["디깅 방법", "음원 폴더 정리", "rekordbox", "USB 내보내기"] },
  { title: "장비 이해", goal: "클럽 장비의 구조를 알고 소리가 어디로 흐르는지 익히는 단계", topics: ["CDJ·믹서 기능과 레이아웃", "신호 흐름", "헤드폰 큐"] },
  { title: "비트매칭", goal: "두 곡의 템포와 박을 귀로 맞추는 단계", topics: ["BPM과 템포", "피치 페이더", "조그로 박 맞추기", "헤드폰으로 듣고 맞추기"] },
  { title: "리듬과 곡 구조", goal: "박과 마디를 세고 곡의 구조를 들으며 섞을 지점을 찾는 단계", topics: ["박·마디·프레이즈", "곡 구조 듣기"] },
  { title: "페이더 믹스", goal: "페이더만으로 충분히 섞어 보며 볼륨의 개념을 확실히 이해하는 단계", topics: ["볼륨의 개념", "게인·레벨 맞추기", "페이더 믹스"] },
  { title: "EQ 믹스와 효과", goal: "볼륨 감각 위에 EQ와 루프·효과로 전환을 다듬는 단계", topics: ["EQ 믹스", "저음 교체", "루프", "효과"] },
  { title: "선곡과 셋 구성", goal: "곡을 고르고 흐름을 설계하는 단계", topics: ["테크노·하우스의 흐름", "선곡과 키", "에너지 곡선과 플로우", "30분 이상 셋 구성"] },
  { title: "실전과 데뷔 준비", goal: "실제 클럽 환경에서 플레이할 준비를 하는 단계", topics: ["클럽 환경에서의 노하우", "셋 녹음과 리뷰", "연습 루틴", "데뷔 준비"] },
] as const;

const sectionTitle = "text-2xl font-semibold leading-8 tracking-display md:text-[30px] md:leading-10";
const bodyMuted = "text-[15px] leading-[26px] text-muted-foreground";

export default function LessonInfoPage() {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground [word-break:keep-all]">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b border-muted bg-background/90 px-4 backdrop-blur md:h-[60px] md:px-12">
        <Link href="/lesson" className="inline-flex items-center gap-2.5">
          <PortalLogoMark size={24} className="shrink-0" />
          <span className="text-[15px] font-semibold">
            Stann Lumo<span className="hidden font-normal text-muted-foreground md:inline"> · DJ 레슨</span>
          </span>
        </Link>
        <nav aria-label="레슨 안내" className="flex items-center gap-1 text-ui">
          <a href="#course" className="hidden px-2.5 py-2 text-secondary-foreground hover:text-foreground md:inline">과정·비용</a>
          <a href="#curriculum" className="hidden px-2.5 py-2 text-secondary-foreground hover:text-foreground md:inline">커리큘럼</a>
          <Link href="/login" className="hidden px-2.5 py-2 text-secondary-foreground hover:text-foreground md:inline">레슨생 로그인</Link>
          <a href="#contact" className="ml-2 inline-flex h-9 items-center rounded-md bg-primary px-3.5 font-medium text-primary-foreground">상담 문의</a>
        </nav>
      </header>

      <div className="px-5 md:px-12">
        <div className="mx-auto flex max-w-[880px] flex-col">
          <section aria-labelledby="lesson-hero-title" className="flex flex-col gap-5 py-14 md:gap-7 md:pb-[88px] md:pt-28">
            <p className="font-mono text-ui tracking-[0.04em] text-muted-foreground">TECHNO · HOUSE · DJ LESSON</p>
            <h1 id="lesson-hero-title" className="text-[32px] font-semibold leading-[42px] tracking-[-0.03em] md:text-[52px] md:leading-[64px]">
              처음 장비를 만지는 날부터
              <br />
              클럽 데뷔까지
            </h1>
            <p className="max-w-[620px] text-base leading-7 text-secondary-foreground md:text-lg md:leading-8">
              테크노와 하우스를 중심으로 9년간 활동해 온 DJ Stann이 각자의 수준과 목표에 맞춰 함께합니다. 현재 이태원 파우스트의 레지던트
              DJ로 활동하고 있습니다.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <a href="#contact" className="inline-flex h-12 flex-1 items-center justify-center rounded-lg bg-primary px-[22px] text-[15px] font-medium text-primary-foreground md:flex-none">
                상담 문의하기
              </a>
              <a href="#course" className="inline-flex h-12 flex-1 items-center justify-center rounded-lg border border-border px-[22px] text-[15px] md:flex-none">
                과정과 비용 보기
              </a>
            </div>
          </section>

          <section aria-label="레슨 요약" className="pb-16 md:pb-24">
            <dl className="grid grid-cols-1 border-t border-foreground md:grid-cols-3">
              {FACTS.map((fact) => (
                <div key={fact.label} className="flex flex-col gap-1.5 border-b border-border py-5 pr-6">
                  <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                  <dd className="text-base font-medium leading-[26px]">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section id="course" aria-labelledby="lesson-course-title" className="flex scroll-mt-20 flex-col gap-8 pb-[72px] md:pb-28">
            <div className="flex flex-col gap-2.5">
              <h2 id="lesson-course-title" className={sectionTitle}>과정과 비용</h2>
              <p className={bodyMuted}>두 과정 모두 4회 단위로 진행합니다. 주 1회 고정 요일을 기본으로, 공유 캘린더에서 일정을 유동적으로 조율합니다.</p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {COURSES.map((course) => (
                <article
                  key={course.name}
                  className={cn(
                    "flex flex-col gap-2.5 rounded-xl p-[22px] md:gap-3 md:p-7",
                    course.featured ? "border-[1.5px] border-foreground" : "border border-border",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-xl font-semibold leading-7">{course.name}</h3>
                    <span className="font-mono text-ui text-muted-foreground">{course.length}</span>
                  </div>
                  <p className={bodyMuted}>{course.desc}</p>
                  <p className="mt-2 flex items-baseline gap-2">
                    <span className="text-[30px] font-semibold leading-9 tracking-display">{course.price}</span>
                    <span className="text-sm text-muted-foreground">4회</span>
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="lesson-method-title" className="grid grid-cols-1 gap-6 pb-[72px] md:grid-cols-2 md:gap-x-16 md:gap-y-10 md:pb-28">
            <h2 id="lesson-method-title" className={sectionTitle}>수업 방식</h2>
            <div className="flex flex-col gap-7">
              {METHODS.map((method) => (
                <div key={method.title} className="flex flex-col gap-1.5">
                  <h3 className="text-base font-semibold leading-6">{method.title}</h3>
                  <p className={bodyMuted}>{method.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="curriculum" aria-labelledby="lesson-curriculum-title" className="flex scroll-mt-20 flex-col gap-8 pb-[72px] md:pb-28">
            <div className="flex flex-col gap-2.5">
              <h2 id="lesson-curriculum-title" className={sectionTitle}>커리큘럼</h2>
              <p className={bodyMuted}>아래는 큰 흐름입니다. 정해진 순서를 일괄적으로 따르기보다, 경험과 관심사에 맞춰 단계를 건너뛰거나 더 머무릅니다.</p>
            </div>
            <ol className="flex flex-col border-t border-foreground">
              {STAGES.map((stage, index) => (
                <li key={stage.title} className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-border py-6 md:grid-cols-[72px_minmax(0,1fr)] md:gap-x-6 md:py-7">
                  <span className="font-mono text-ui leading-7 text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <h3 className="text-xl font-semibold leading-7">{stage.title}</h3>
                      <p className={bodyMuted}>{stage.goal}</p>
                    </div>
                    <ul className="flex flex-wrap gap-1.5" aria-label={`${stage.title}에서 다루는 것`}>
                      {stage.topics.map((topic) => (
                        <li key={topic} className="rounded-full bg-muted px-2.5 py-1 text-ui text-secondary-foreground">{topic}</li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section id="contact" aria-labelledby="lesson-contact-title" className="mb-14 flex scroll-mt-20 flex-col gap-5 rounded-[14px] bg-primary px-6 py-7 text-primary-foreground md:mb-24 md:rounded-2xl md:p-12">
            <h2 id="lesson-contact-title" className={sectionTitle}>상담은 편하게 연락 주세요</h2>
            <p className="max-w-[560px] text-base leading-7 text-primary-foreground/80">
              장비를 한 번도 다뤄보지 않으셨어도 괜찮습니다. 궁금한 점은 인스타그램 DM으로 언제든 문의해 주세요. 원하시면 직접 만나 간단한
              상담도 가능합니다.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <a
                href={INSTAGRAM_DM_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-background px-[22px] text-[15px] font-medium text-foreground md:flex-none"
              >
                <Instagram className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
                인스타그램 DM 보내기
              </a>
              <a href={INSTAGRAM_PROFILE_URL} target="_blank" rel="noreferrer" className="font-mono text-sm text-primary-foreground/70 underline-offset-4 hover:underline">
                @{INSTAGRAM_HANDLE}
              </a>
            </div>
            <p className="text-ui leading-[22px] text-primary-foreground/70">
              문의하실 때 디제잉 경험, 관심 있는 과정(정규·취미), 가능한 요일을 함께 적어 주시면 빠르게 안내해 드립니다.
            </p>
          </section>
        </div>
      </div>

      <footer className="border-t border-muted px-5 pb-10 pt-6 md:px-12">
        <div className="mx-auto flex max-w-[880px] flex-wrap justify-between gap-3 text-ui text-muted-foreground">
          <span>Stann Lumo · 이태원 파우스트 탄즈바</span>
          <Link href="/login" className="text-secondary-foreground hover:text-foreground">레슨생 로그인</Link>
        </div>
      </footer>
    </div>
  );
}
