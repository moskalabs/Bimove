-- ============================================================
-- 스냅샷을 jsonb 에서 gzip text 로 옮긴다
--
-- 적용 방법: Supabase Dashboard > SQL Editor에서 실행
--
-- tldraw 스냅샷(수 MB JSON)을 `snapshot` jsonb 컬럼에 5초마다 그대로 넣고
-- 있었다. jsonb 는 들어올 때마다 **파싱하고 TOAST 로 압축**한다. 수 MB 를 그
-- 주기로 받으면 작은 인스턴스는 CPU 가 버티지 못한다 — 실제로 t4g.nano 가
-- CPU 94% 에 묶여 REST 요청이 전부 504 로 떨어지고 로그인조차 안 됐다.
--
-- 클라이언트가 gzip + base64 로 줄여 text 컬럼에 넣는다. 서버는 글자를 그대로
-- 받아 적기만 하므로 파싱 비용이 0 이고 크기도 1/10 쯤으로 준다.
--
-- 옛 `snapshot` 컬럼은 **지우지 않는다.** 이미 저장된 프로젝트가 거기 들어
-- 있고, 클라이언트는 둘 다 읽을 수 있다 (snapshotCodec.readSnapshotColumn).
-- 다음 저장 때 압축본으로 옮겨가고 옛 컬럼은 null 이 된다.
-- ============================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS snapshot_gz text;

ALTER TABLE public.project_versions
  ADD COLUMN IF NOT EXISTS snapshot_gz text;

COMMENT ON COLUMN public.projects.snapshot_gz IS
  'tldraw 스냅샷 (JSON → gzip → base64). 옛 jsonb snapshot 컬럼을 대신한다.';
COMMENT ON COLUMN public.project_versions.snapshot_gz IS
  'tldraw 스냅샷 (JSON → gzip → base64). 옛 jsonb snapshot 컬럼을 대신한다.';

-- project_versions.snapshot 은 NOT NULL 일 수 있다. 이제 압축 컬럼에만 쓰므로
-- 제약을 풀어둔다 (컬럼이 이미 nullable 이면 아무 일도 하지 않는다).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'project_versions'
      AND column_name = 'snapshot' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.project_versions ALTER COLUMN snapshot DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects'
      AND column_name = 'snapshot' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.projects ALTER COLUMN snapshot DROP NOT NULL;
  END IF;
END $$;

-- ── 쌓여 있던 자동 생성 버전 정리 ──
--
-- 목록 조회는 처음부터 30개만 보여줬는데 **지우는 코드가 없었다**. 자동
-- 저장되는 수 MB 스냅샷이 서버에는 무한정 쌓여 project_versions 가 206MB 로
-- DB 의 대부분을 차지했다.
--
-- **라벨이 비었는지로 가르면 안 된다.** 자동 저장은 '자동저장', 충돌 백업은
-- '충돌 백업 — …' 라벨을 달고 들어온다 — 실제로 170개 전부 라벨이 있었다.
-- 사용자가 직접 지은 이름만 남긴다.
--
-- 충돌 백업이 146MB 로 제일 큰데, 대부분 10/8~10/9 몇 분 사이에 몰려 있다.
-- 타임스탬프 표기 차이로 자기 저장을 남의 것으로 오해하던 버그가 5초마다
-- 백업을 떠댄 결과다 (6bb0d3e 에서 고쳤다).
WITH ranked AS (
  SELECT id, row_number() OVER (
           PARTITION BY project_id ORDER BY created_at DESC
         ) AS rn
  FROM public.project_versions
  WHERE label IS NULL
     OR label = '자동저장'
     OR label LIKE '충돌 백업%'
)
DELETE FROM public.project_versions v
USING ranked r
WHERE v.id = r.id AND r.rn > 30;
