export type ServerSaveConfirmationState<Response> = Readonly<{
  handledResponse: Response | null;
  visible: boolean;
}>;

/** 서버 저장 응답과 사용자 입력 사이의 성공 확인 생명주기를 시작한다. */
export function createServerSaveConfirmationState<Response>(): ServerSaveConfirmationState<Response> {
  return { handledResponse: null, visible: false };
}

/** 아직 처리하지 않은 서버 저장 응답만 새 성공 확인으로 승인한다. */
export function acknowledgeServerSaveResponse<Response>(
  current: ServerSaveConfirmationState<Response>,
  response: Response | null | undefined,
): ServerSaveConfirmationState<Response> {
  if (response == null || Object.is(current.handledResponse, response)) return current;
  return { handledResponse: response, visible: true };
}

/** 다음 입력·복구 뒤에는 같은 과거 응답이 성공 확인을 되살리지 못하게 한다. */
export function dismissServerSaveConfirmation<Response>(
  current: ServerSaveConfirmationState<Response>,
): ServerSaveConfirmationState<Response> {
  return current.visible ? { ...current, visible: false } : current;
}

/** 현재 action state가 실제로 승인한 최신 응답일 때만 성공 확인을 노출한다. */
export function isServerSaveConfirmationVisible<Response>(
  current: ServerSaveConfirmationState<Response>,
  response: Response | null | undefined,
): boolean {
  return (
    current.visible &&
    response != null &&
    Object.is(current.handledResponse, response)
  );
}
