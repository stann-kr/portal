import type { NextPageContext } from "next";

interface ErrorProps {
  statusCode?: number;
}

/**
 * Pages Router 커스텀 에러 페이지.
 * getInitialProps로 SSR 처리하여 정적 생성 단계에서의 <Html> 컨텍스트 오류 방지.
 */
export default function ErrorPage({ statusCode }: ErrorProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        textAlign: "center",
        fontFamily: "sans-serif",
      }}
    >
      <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "1rem" }}>
        {statusCode ?? "오류"}
      </h1>
      <p style={{ color: "var(--color-muted-foreground)" }}>
        {statusCode === 404
          ? "페이지를 찾을 수 없습니다."
          : "서버 오류가 발생했습니다."}
      </p>
    </div>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};
