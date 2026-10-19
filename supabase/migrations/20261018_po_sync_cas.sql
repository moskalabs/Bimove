-- ============================================================
-- sync_purchase_order: 낙관적 잠금(CAS)을 **함수 안으로** 넣는다
--
-- 적용 방법: Supabase Dashboard > SQL Editor 에서 실행
--
-- ── 왜 ──
--
-- 클라이언트가 "권리를 집고(updated_at 을 앞으로 찍고) 그 다음 RPC 를 부르는"
-- 식으로 낙관적 잠금을 했다. 두 번의 왕복이라 **원자적이지 않다.**
--
--   claim(UPDATE updated_at) → [여기서 끊기면] → sync_purchase_order(...)
--
-- 가운데서 끊기면 **내용은 그대로인데 시각만 전진한** 상태가 남는다. 그러면
--   1. 다음 시도가 제 claim 을 "다른 기기 충돌" 로 오인해 영영 멈추고,
--   2. 그 사이 새로고침하면 안 바뀐 서버가 더 최신으로 보여 로컬을 덮는다.
--
-- 클라이언트에 되돌리기(보상 동작)를 넣어 창을 좁혀 뒀지만, 그건 되돌리기
-- 자체가 또 실패할 수 있다. 검사와 쓰기가 **한 트랜잭션** 안에 있어야 끝난다.
--
-- ── 무엇이 달라지나 ──
--
-- 인자 셋짜리를 **새로 만든다** (기존 둘짜리는 그대로 둔다). 배포 전 클라이언트가
-- 돌고 있을 수 있어서, 있던 함수를 바꾸면 그쪽이 깨진다.
--
--   p_expected_updated_at NULL  → **서버에 발주서가 없어야 한다.** 있으면 P0409
--   값이 있고 서버와 같다       → 쓴다
--   값이 있고 서버와 다르다     → **아무것도 안 쓰고** P0409 로 올린다
--   값이 있는데 행이 없다       → 기대한 행이 사라졌다. P0409
--
-- 행을 FOR UPDATE 로 잡고 비교하므로, 같은 순간에 들어온 두 요청 중 하나는
-- 반드시 기다렸다가 달라진 시각을 보고 충돌로 떨어진다.
--
-- ── NULL 이 "검사 없음" 이 아니라 "없어야 함" 인 이유 ──
--
-- 클라이언트가 NULL 을 보내는 경우는 하나뿐이다: **서버를 읽었는데 발주서가
-- 없었다.** (읽기에 실패한 세션은 아예 서버로 쓰지 않는다.) 그걸 "검사 없음"
-- 으로 받으면, 읽은 뒤 첫 저장 전에 다른 기기가 발주서를 만들었을 때 그걸
-- 통째로 지우고 이쪽 내용으로 바꾼다 — 이 함수는 3단계에서 기존 물량표를
-- 전부 DELETE 하기 때문이다.
--
-- 없는 행은 FOR UPDATE 로 못 잠근다. 그래서 "없어야 함" 쪽은 잠금이 아니라
-- **유니크 인덱스**로 가린다: ON CONFLICT DO NOTHING 으로 넣어 보고, 아무것도
-- 안 들어왔으면 그 사이 누가 만든 것이다. 동시에 들어온 첫 저장 둘 중 하나는
-- 반드시 여기서 떨어진다.
--
-- ── 새 시각을 **같은 트랜잭션에서** 돌려준다 ──
--
-- 전엔 uuid 를 돌려주고 클라이언트가 updated_at 을 따로 읽었다. 그 사이에
-- 다른 기기가 저장하면, 그 기기의 시각을 제 기준값으로 삼는다 — 내용은 보지도
-- 않은 채 다음 CAS 가 통과해서 상대 변경을 덮는다. 쓴 값을 그대로 돌려주면
-- 그 창이 없다.
-- ============================================================

-- 돌려주는 타입이 uuid 에서 timestamptz 로 바뀌었다. CREATE OR REPLACE 로는
-- 반환 타입을 못 바꾸므로 먼저 지운다. 셋짜리는 아직 아무도 안 쓴다
-- (클라이언트가 없으면 둘짜리로 떨어지게 되어 있다).
DROP FUNCTION IF EXISTS public.sync_purchase_order(uuid, jsonb, timestamptz);

CREATE FUNCTION public.sync_purchase_order(
  p_project_id uuid,
  p_tables jsonb,
  p_expected_updated_at timestamptz
) RETURNS timestamptz AS $$
DECLARE
  v_po_id uuid;
  v_new timestamptz;
  v_cur timestamptz;
  v_found boolean;
  v_table jsonb;
  v_item jsonb;
  v_ex jsonb;
  v_table_id uuid;
  v_item_id uuid;
BEGIN
  -- 0. 소유권 검사. RLS 를 우회하는 함수이므로 여기서 직접 봐야 한다.
  --    42501 = insufficient_privilege (PostgREST 가 403 으로 바꿔 보낸다)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sync_purchase_order: 로그인이 필요합니다'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = p_project_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'sync_purchase_order: 이 프로젝트에 대한 권한이 없습니다'
      USING ERRCODE = '42501';
  END IF;

  -- 1. 낙관적 잠금. **쓰기 전에** 본다.
  --
  --    FOR UPDATE 로 행을 잡는다. 안 잡으면 두 요청이 같은 값을 읽고 둘 다
  --    통과한 뒤 나중 것이 먼저 것을 덮는다 — 검사가 있으나 마나다.
  --    행이 없으면(아직 발주서가 없으면) 검사할 것도 없다.
  SELECT updated_at INTO v_cur
  FROM purchase_orders
  WHERE project_id = p_project_id
  FOR UPDATE;
  v_found := FOUND;

  IF v_found AND v_cur IS DISTINCT FROM p_expected_updated_at THEN
    -- 기대와 다르다. p_expected_updated_at 이 NULL 인 경우(= 없어야 하는데
    -- 있다)도 여기로 떨어진다 — IS DISTINCT FROM 은 NULL 을 값처럼 견준다.
    --
    -- 아무것도 안 썼다. 예외를 내면 트랜잭션이 통째로 되돌아가므로
    -- "반쯤 쓰인" 상태가 남을 수 없다.
    RAISE EXCEPTION 'sync_purchase_order: 다른 기기가 먼저 저장했습니다 (서버 %, 기대 %)',
      v_cur, p_expected_updated_at
      USING ERRCODE = 'P0409';
  END IF;

  IF NOT v_found AND p_expected_updated_at IS NOT NULL THEN
    -- 기대한 행이 사라졌다 (다른 기기가 프로젝트를 지웠거나 되돌렸다).
    -- 조용히 새로 만들면 그쪽 삭제를 없던 일로 만든다.
    RAISE EXCEPTION 'sync_purchase_order: 기대한 발주서가 서버에 없습니다 (기대 %)',
      p_expected_updated_at
      USING ERRCODE = 'P0409';
  END IF;

  -- 2. purchase_order 행 확보
  IF v_found THEN
    UPDATE purchase_orders SET updated_at = now()
    WHERE project_id = p_project_id
    RETURNING id, updated_at INTO v_po_id, v_new;
  ELSE
    -- 없는 행은 FOR UPDATE 로 못 잠근다. 유니크 인덱스에 맡긴다 —
    -- 동시에 들어온 첫 저장 둘 중 늦은 쪽은 아무것도 못 넣고 아래서 떨어진다.
    INSERT INTO purchase_orders (project_id, updated_at)
    VALUES (p_project_id, now())
    ON CONFLICT (project_id) DO NOTHING
    RETURNING id, updated_at INTO v_po_id, v_new;

    IF v_po_id IS NULL THEN
      RAISE EXCEPTION 'sync_purchase_order: 그 사이 다른 기기가 발주서를 만들었습니다'
        USING ERRCODE = 'P0409';
    END IF;
  END IF;

  -- 3. 기존 데이터 삭제 (CASCADE로 items/exclusions도 삭제)
  DELETE FROM boq_tables WHERE purchase_order_id = v_po_id;

  -- 4. 새 데이터 삽입
  FOR v_table IN SELECT * FROM jsonb_array_elements(p_tables)
  LOOP
    INSERT INTO boq_tables (id, purchase_order_id, template_id, label, sort_order)
    VALUES (
      (v_table->>'id')::uuid,
      v_po_id,
      v_table->>'template_id',
      v_table->>'label',
      (v_table->>'sort_order')::int
    )
    RETURNING id INTO v_table_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_table->'items', '[]'::jsonb))
    LOOP
      INSERT INTO boq_items (
        id, boq_table_id, name, material,
        width_mm, height_mm, item_width_mm, item_length_mm,
        loss_rate, unit_price, unit,
        calc_method, length_m, manual_qty,
        sort_order
      ) VALUES (
        (v_item->>'id')::uuid,
        v_table_id,
        v_item->>'name',
        v_item->>'material',
        COALESCE((v_item->>'width_mm')::numeric, 0),
        COALESCE((v_item->>'height_mm')::numeric, 0),
        COALESCE((v_item->>'item_width_mm')::numeric, 0),
        COALESCE((v_item->>'item_length_mm')::numeric, 0),
        COALESCE((v_item->>'loss_rate')::numeric, 0),
        COALESCE((v_item->>'unit_price')::numeric, 0),
        COALESCE(v_item->>'unit', 'm²'),
        COALESCE(v_item->>'calc_method', 'area'),
        COALESCE((v_item->>'length_m')::numeric, 0),
        COALESCE((v_item->>'manual_qty')::numeric, 0),
        COALESCE((v_item->>'sort_order')::int, 0)
      )
      RETURNING id INTO v_item_id;

      FOR v_ex IN SELECT * FROM jsonb_array_elements(COALESCE(v_item->'exclusions', '[]'::jsonb))
      LOOP
        INSERT INTO boq_exclusions (id, boq_item_id, type, label, shape_id, width_mm, height_mm)
        VALUES (
          (v_ex->>'id')::uuid,
          v_item_id,
          v_ex->>'type',
          v_ex->>'label',
          v_ex->>'shape_id',
          COALESCE((v_ex->>'width_mm')::numeric, 0),
          COALESCE((v_ex->>'height_mm')::numeric, 0)
        );
      END LOOP;
    END LOOP;
  END LOOP;

  -- 쓴 시각을 **같은 트랜잭션에서** 돌려준다. 클라이언트가 이걸 다음 CAS 의
  -- 기준으로 쓴다 — 따로 읽으면 그 사이 들어온 남의 저장 시각을 제 것으로
  -- 삼게 된다.
  RETURN v_new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 둘짜리와 같은 권한. PUBLIC/anon 에 남아 있으면 auth.uid() 검사까지 가기 전에
-- 이미 공격면이 열린다.
REVOKE ALL ON FUNCTION public.sync_purchase_order(uuid, jsonb, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_purchase_order(uuid, jsonb, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_purchase_order(uuid, jsonb, timestamptz) TO authenticated;

-- ── 적용한 뒤 ──
--
-- 클라이언트(lib/supabaseSync.ts)는 셋짜리를 먼저 부르고, 없으면(PGRST202)
-- 예전 길인 "집고 → 둘짜리" 로 떨어진다. 그래서 이 마이그레이션을 안 돌려도
-- 동작은 하고, 돌리면 비원자성 창이 사라진다. 돌린 뒤에 클라이언트를 바꿀
-- 필요는 없다.
