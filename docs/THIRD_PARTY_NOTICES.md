# 제3자 구성요소 고지

브라우저에 내려가는 오디오 변환 모듈의 라이선스 고지다. 서버 Worker에는 포함되지 않고, WAV·AIFF·FLAC 업로드를 변환할 때만 별도 Web Worker 청크로 내려받는다.

| 구성요소 | 사용처 | 라이선스 | 원본 |
|---|---|---|---|
| wasm-media-encoders 0.7.x | MP3 인코딩 래퍼 | MIT | https://github.com/arseneyr/wasm-media-encoders |
| LAME (위 패키지에 WebAssembly로 포함) | MP3 인코더 | LGPL-2.0-or-later | https://lame.sourceforge.io/ |
| @wasm-audio-decoders/flac 0.2.x | FLAC 디코딩 | MIT | https://github.com/eshaz/wasm-audio-decoders |
| libFLAC (위 패키지에 포함) | FLAC 디코더 | BSD-3-Clause | https://xiph.org/flac/ |

LAME은 수정하지 않고 별도 WebAssembly 모듈로 동적으로 불러온다. 사용자는 원본 소스를 위 주소에서 받을 수 있고, 같은 인터페이스의 다른 빌드로 바꿔 쓸 수 있다.
