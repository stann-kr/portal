import type { ReactNode } from "react";

export const metadata = { title: "개인정보처리방침" };

/** 개정 시 이 날짜와 본문을 함께 바꾼다. */
const EFFECTIVE_DATE = "2026년 10월 28일";
const CONTACT_EMAIL = "stannlumo@gmail.com";

/**
 * @file src/app/privacy/page.tsx
 * @description 로그인 없이 여는 개인정보처리방침. Google OAuth 동의 화면의 개인정보처리방침 링크가 이 주소를 가리킨다.
 * 외부 캘린더(Google·iCloud) 데이터의 사용 범위는 Google API 서비스 사용자 데이터 정책의 제한적 사용 요구를 따른다.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-[680px] bg-background px-5 py-12 text-foreground">
      <h1 className="text-2xl font-semibold tracking-display">개인정보처리방침</h1>
      <p className="mt-2 text-sm text-muted-foreground">Stann Lumo Portal · 시행일 {EFFECTIVE_DATE}</p>

      <Section title="1. 이 포털">
        <p>
          Stann Lumo Portal(이하 &ldquo;포털&rdquo;)은 Stann Lumo의 DJ 레슨 학생과 강사가 레슨 일정, 과제·피드백, 커리큘럼, 노트와 질문을
          관리하는 비공개 서비스입니다. 계정은 강사가 초대한 학생과 강사에게만 발급됩니다.
        </p>
      </Section>

      <Section title="2. 처리하는 정보">
        <ul>
          <li>계정: 이메일 주소, 표시 이름, 비밀번호 해시, 역할(학생·강사)</li>
          <li>레슨 기록: 레슨 일정, 과제와 제출물(믹스셋 링크·글·파일), 피드백, 노트, 질문과 답변, 커뮤니티 글과 댓글</li>
          <li>캘린더: 포털에서 만든 일정과, 강사가 연결한 외부 캘린더(Google 캘린더·iCloud 캘린더)의 일정 제목·시간·설명·반복 규칙</li>
          <li>운영 정보: 로그인 유지와 보안을 위한 세션 정보, 오류 기록</li>
        </ul>
      </Section>

      <Section title="3. Google 사용자 데이터">
        <p>강사가 Google 계정을 연결하면 포털은 다음 권한만 요청합니다.</p>
        <ul>
          <li>캘린더 목록 읽기: 학생별로 동기화할 캘린더를 고르고 연결한 계정을 표시하기 위해</li>
          <li>일정 읽기·쓰기: 선택한 캘린더와 포털의 레슨·일정을 양방향으로 맞추기 위해</li>
        </ul>
        <p>
          Google API에서 받은 정보는 포털 화면에 일정을 보여 주고 선택한 캘린더와 동기화하는 데에만 사용합니다. 광고, 판매, 제3자 제공, 신용
          평가, AI·머신러닝 모델 학습에는 사용하지 않으며, 사람이 읽는 것은 사용자의 동의가 있거나 보안·법적 의무 또는 오류 해결에 필요한
          경우로 한정합니다. 포털의 Google API 정보 사용과 다른 앱으로의 전송은{" "}
          <a
            className="underline underline-offset-2"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            rel="noreferrer"
            target="_blank"
          >
            Google API 서비스 사용자 데이터 정책
          </a>
          의 제한적 사용(Limited Use) 요구사항을 따릅니다.
        </p>
      </Section>

      <Section title="4. 보관과 보호">
        <ul>
          <li>정보는 Cloudflare의 데이터베이스와 저장소에 보관하고, 전송 구간은 HTTPS로 암호화합니다.</li>
          <li>외부 캘린더 로그인 정보(Google 토큰, iCloud 앱 전용 암호)는 암호화해 저장하고 화면에 다시 보여 주지 않습니다.</li>
          <li>학생은 자기 정보만, 강사는 담당 학생의 정보만 볼 수 있습니다.</li>
        </ul>
      </Section>

      <Section title="5. 연결 해제와 삭제">
        <ul>
          <li>
            강사는 포털의 캘린더 동기화 설정에서 언제든 외부 캘린더 연결을 해제할 수 있습니다. 해제하면 저장한 로그인 정보와 동기화 기록을
            삭제합니다. Google 쪽 권한은{" "}
            <a className="underline underline-offset-2" href="https://myaccount.google.com/permissions" rel="noreferrer" target="_blank">
              Google 계정 권한 페이지
            </a>
            에서도 철회할 수 있습니다.
          </li>
          <li>계정과 그 계정의 포털 데이터 삭제를 원하면 아래 연락처로 요청해 주세요.</li>
        </ul>
      </Section>

      <Section title="6. 문의">
        <p>
          개인정보 관련 문의는{" "}
          <a className="underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          로 보내 주세요. 방침이 바뀌면 이 페이지의 시행일과 내용을 갱신합니다.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 space-y-3 text-sm leading-relaxed [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}
