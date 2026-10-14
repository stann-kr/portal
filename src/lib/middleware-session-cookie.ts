/**
 * Auth.js middleware는 session이 있으면 모든 요청 응답에 만료를 늘린 session cookie를 붙인다.
 * OpenNext는 middleware의 Set-Cookie를 앱 응답의 Set-Cookie 뒤에 합치므로, 같은 요청에서
 * server action이 cookie를 지우거나(로그아웃) 새로 발급해도(비밀번호 변경 뒤 재로그인)
 * 브라우저에는 middleware가 붙인 이전 session이 남는다. 상태를 바꾸는 요청에서는
 * middleware의 갱신 cookie를 떼어 action이 정한 cookie만 남긴다. 만료 연장은 다음 화면 요청이 맡는다.
 */
export function withoutSessionRefreshOnMutation(
  method: string,
  response: Response | undefined,
): Response | undefined {
  if (!response || method === "GET" || method === "HEAD") return response;
  if (!response.headers.has("set-cookie")) return response;

  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
