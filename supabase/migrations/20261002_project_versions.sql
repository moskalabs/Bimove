-- ============================================================
-- project_versions — 프로젝트 스냅샷 버전 기록
--
-- src/lib/supabase.ts 의 DBProjectVersion 과 supabaseSync.ts 의
-- fetchProjectVersionMetas / saveProjectVersion 이 이 테이블을 쓴다.
-- 예전엔 타입과 함수만 있고 테이블도 호출부도 없어서, 버전이 localStorage
-- 에만 쌓였다 — 기기를 바꾸거나 캐시를 지우면 전부 사라졌다.
--
-- 적용 방법: Supabase Dashboard > SQL Editor에서 실행
-- ============================================================

CREATE TABLE IF NOT EXISTS public.project_versions (
  id          uuid PRIMARY KEY,                 -- 클라이언트가 crypto.randomUUID() 로 만든다
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  label       text,
  snapshot    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 목록은 항상 프로젝트별 최신순으로 읽는다
CREATE INDEX IF NOT EXISTS project_versions_project_created_idx
  ON public.project_versions (project_id, created_at DESC);

-- ── RLS: projects.user_id 체인 (purchase_orders 와 같은 방식) ──
ALTER TABLE public.project_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own project_versions" ON public.project_versions;
CREATE POLICY "Users can manage own project_versions"
  ON public.project_versions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = project_versions.project_id
        AND projects.user_id = auth.uid()
    )
  );
