# 자체 호스팅 폰트

## 왜 레포에 두나

전엔 Google Fonts CDN 에서 받았다. 그게 두 가지로 문제였다.

1. **CDN 이 막히면 한글이 깨진다.** 현장 사무실 방화벽이 외부 CDN 을 막는 일이
   드물지 않다. CAD 도면의 한글 글씨가 우리 쪽 폰트 매핑으로 Noto Sans KR 에
   걸려 있어서(`dxf-fast-worker.ts` 의 한글 폰트 매핑), 못 받으면 폴백으로
   떨어진다.
2. **CADCraft 엔진은 폰트를 주입받아야 한다.** wasm 에는 시스템 폰트가 없어서
   `registerFont` 로 넣지 않으면 글자가 전부 □ 로 나온다 (`lib/cadcraft.ts`).

## 라이선스

`NotoSansKR.ttf` — **SIL Open Font License 1.1** (`OFL.txt` 전문 동봉).

OFL 은 번들·재배포·임베딩을 명시적으로 허용한다. 상용 제품에 넣어도 되고
로열티도 없다. 지켜야 할 것은 두 가지뿐이다.

- 저작권 표시와 라이선스 전문을 같이 둘 것 → `OFL.txt`
- 폰트 **자체만** 따로 팔지 말 것 → 해당 없음

Reserved Font Name 은 `'Source'` 다. 우리는 **고치지 않고 그대로** 싣고
`Noto Sans KR` 이라는 이름으로 쓰므로 이름을 바꿀 의무가 없다. 서브셋을
만들게 되면 그때 다시 보라 — 서브셋도 OFL 상 "수정" 이다.

## 갱신

Google Fonts 의 TTF 를 그대로 받는다 (woff2 는 엔진의 폰트 파서가 못 읽는다).

```sh
curl -H "User-Agent: Mozilla/4.0" \
  "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400" \
  | grep -oE "https://[^)]*\.ttf"
# 나온 URL 을 받아 NotoSansKR.ttf 로 둔다
```
