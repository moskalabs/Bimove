# DXF/DWG 한글 인코딩 해결 기록

> 2026-09-19 | `src/lib/dxf.ts`

## 문제 현상

DWG/DXF 파일을 Bimove에 import하면 한글 텍스트가 깨져서 표시됨.

| 원래 텍스트 | 깨진 표시 |
|---|---|
| 현장명 | ÇöÀå¸í |
| 내부 리모델링 | ³»ºÎ ¸®¸ðµ¨¸µ |
| 디자인 설계도면 | µðÀÚÀÎ ¼³°èµµ¸é |

- DXF 직접 업로드, DWG→DXF 변환 양쪽 모두 발생
- 한글만 깨지고 영문/숫자는 정상
- 한국 AutoCAD에서 생성된 파일에서 발생

---

## 원인 분석: 3가지 계층의 인코딩 문제

### 1. 단순 EUC-KR 인코딩 (DXF 파일)

한국 AutoCAD는 텍스트를 EUC-KR(CP949) 인코딩으로 저장. 브라우저의 `File.text()`나 `TextDecoder()`는 기본 UTF-8로 읽어서 한글이 깨짐.

**해결**: `file.arrayBuffer()` → `TextDecoder('euc-kr')` 사용.

### 2. 인코딩 감지 실패 (기존 detectNonUtf8)

초기 구현은 UTF-8로 이미 디코딩된 텍스트에서 mojibake 패턴을 찾는 방식이었는데, EUC-KR 바이트 중 일부(0xC2-0xC8 범위)가 valid UTF-8 시퀀스를 형성해서 U+FFFD도 안 나오고 감지 실패.

**해결**: `detectDxfEncoding(buffer)` - raw bytes를 직접 스캔.

### 3. 이중 인코딩 (DWG 변환, **핵심 원인**)

가장 어려웠던 문제. DWG 파일의 `$DWGCODEPAGE`가 `ANSI_1252` (Latin-1)로 설정되어 있지만, 실제 텍스트는 EUC-KR.

DWG→DXF 변환기(dwgdxf WASM)가 이렇게 처리:

```
EUC-KR 바이트: C7 F6 (현)
    ↓ Latin-1로 해석
Unicode: U+00C7 U+00F6 (Ç ö)
    ↓ UTF-8로 인코딩
UTF-8 바이트: C3 87 C3 B6
```

결과:
- **valid UTF-8** → U+FFFD가 0개 → 감지 불가
- **EUC-KR 바이트 패턴 없음** → raw byte 검사도 통과
- **Latin Extended 문자(Ç, ö, À, å 등)** 로 표시됨

**해결**: `reverseDoubleEncodingIfNeeded()` - Latin-1 바이트로 복원 → EUC-KR 재디코딩.

---

## 해결 방법: 디코딩 파이프라인

```
DWG/DXF 파일
    ↓
[DWG인 경우] dwgToDxfBytes() → DXF 바이트
    ↓
decodeDxfBytes(dxfBytes)
    ├── detectDxfEncoding(buffer)
    │     1. $DWGCODEPAGE 헤더 검색 (raw ASCII bytes)
    │     2. UTF-8 유효성 확인 (U+FFFD 카운트)
    │        - U+FFFD=0 → 'utf-8' (이중 인코딩은 다음 단계에서)
    │        - U+FFFD>3 → 'euc-kr'
    │     3. EUC-KR 바이트 패턴 (0xB0-0xC8 + 0xA1-0xFE)
    │     4. CP949 확장 범위
    ├── TextDecoder(encoding).decode(dxfBytes)
    └── reverseDoubleEncodingIfNeeded(text)
          1. 한글 있으면 → 스킵 (이미 정상)
          2. Latin Extended 문자(U+0080-U+00FF) 5개 이상?
          3. 전체 텍스트를 Latin-1 바이트로 복원
          4. EUC-KR 재디코딩 → 한글 있으면 성공
```

---

## 핵심 함수 레퍼런스

### `detectDxfEncoding(buffer: ArrayBuffer): 'utf-8' | 'euc-kr'`

raw bytes에서 인코딩 감지. UTF-8 디코딩 전에 호출.

1. `$DWGCODEPAGE` 헤더를 ASCII 바이트로 직접 검색 (949, 936, 950, 932, KSC 등)
2. UTF-8 유효성 확인: `U+FFFD=0`이면 valid UTF-8 → 바이트 패턴 검사 스킵
3. EUC-KR 한글 바이트 패턴: first byte 0xB0-0xC8, second byte 0xA1-0xFE
4. CP949 확장 범위: first byte 0x81-0xFE

**주의**: valid UTF-8인데 EUC-KR 바이트 패턴과 우연히 겹치는 경우(false positive) 방지를 위해 U+FFFD=0이면 즉시 'utf-8' 반환.

### `reverseDoubleEncodingIfNeeded(text: string): string`

이중 인코딩 복원. DWG 변환 후 호출.

- 조건: 한글 없음 + Latin Extended 문자 5개 이상
- 처리: `charCodeAt()` → Latin-1 바이트 배열 → `TextDecoder('euc-kr')` 재디코딩
- 검증: 복원 결과에 한글(U+AC00-U+D7AF) 있으면 성공

### `decodeDxfBytes(dxfBytes: Uint8Array): string`

DXF 바이트를 인코딩 감지 + 이중 인코딩 복원까지 원스톱 처리. DXF/DWG 양쪽 경로에서 공통 사용.

### `decodeDxfSpecialChars(text: string): string`

DXF 특수문자 코드 변환: `%%P`→±, `%%D`→°, `%%C`→∅

---

## 커밋 이력

| 커밋 | 내용 |
|---|---|
| `979af96` | EUC-KR 인코딩 자동 감지 (초기 버전, `detectNonUtf8`) |
| `bcf7c53` | DXF 특수문자 코드 유니코드 변환 |
| `6c8e004` | `detectDxfEncoding` raw bytes 기반으로 전면 교체 |
| `67028fb` | DWG 변환 경로에도 인코딩 감지 적용 |
| `aff042f` | **이중 인코딩 복원** (`reverseDoubleEncodingIfNeeded`) |
| `0284380` | `detectDxfEncoding` false positive 방지 (valid UTF-8 가드) |
| `1567e7e` | `ArrayBufferLike` → `ArrayBuffer` 타입 캐스팅 |

---

## 교훈

1. **DWG 변환기를 맹신하지 마라**: `$DWGCODEPAGE=ANSI_1252`라고 해도 실제 텍스트는 EUC-KR일 수 있다
2. **이미 디코딩된 텍스트에서 인코딩 감지하는 건 불안정**: raw bytes를 직접 보는 게 정확하다
3. **valid UTF-8이 항상 정상은 아님**: 이중 인코딩은 valid UTF-8을 만들어내지만 내용은 깨져있다
4. **false positive 주의**: UTF-8 멀티바이트 시퀀스가 EUC-KR 패턴과 우연히 겹칠 수 있다
