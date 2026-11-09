# 제3자 구성요소 고지

브라우저에 내려가는 오디오 변환 모듈의 라이선스 고지다. 서버 Worker에는 포함되지 않고, WAV·AIFF·FLAC 업로드를 변환할 때만 별도 Web Worker 청크로 내려받는다.

| 구성요소 | 사용처 | 라이선스 | 원본 |
|---|---|---|---|
| wasm-media-encoders 0.7.x | MP3 인코딩 래퍼 | MIT | https://github.com/arseneyr/wasm-media-encoders |
| LAME 3.100 (위 패키지가 WebAssembly로 빌드, `public/vendor/lame/mp3.wasm`) | MP3 인코더 | LGPL-2.0-or-later | https://lame.sourceforge.io/ |
| @wasm-audio-decoders/flac 0.2.x | FLAC 디코딩 | MIT | https://github.com/eshaz/wasm-audio-decoders |
| libFLAC (위 패키지에 포함) | FLAC 디코더 | BSD-3-Clause | https://xiph.org/flac/ |

LAME은 수정하지 않았다. 패키지 기본값(JS에 base64로 내장)을 쓰지 않고 `public/vendor/lame/mp3.wasm`(패키지 `wasm/mp3.wasm` 사본)을 변환 때 따로 받는다. 그래서 같은 인터페이스로 빌드한 다른 파일로 바꿔 쓸 수 있다.

사이트 방문자용 고지는 로그인 없이 열리는 아래 주소에 둔다.
- `/licenses/THIRD_PARTY_NOTICES.txt`: 이 표와 같은 내용, 원본 소스·빌드 스크립트 주소
- `/licenses/LGPL-2.0.txt`: LGPL v2 전문

`wasm-media-encoders`를 올리면 `public/vendor/lame/mp3.wasm`을 다시 복사하고 위 버전 표기를 고친다. `src/lib/audio/audio-vendor-wasm.test.ts`가 사본 일치를 확인한다.
