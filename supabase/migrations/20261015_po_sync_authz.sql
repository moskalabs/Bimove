-- ============================================================
-- sync_purchase_order 권한 보강 + SECURITY DEFINER 함수 search_path 고정
--
-- 적용 방법: Supabase Dashboard > SQL Editor에서 실행
--
-- 20260728_po_sync_rpc.sql 이 만든 함수에 구멍이 셋 있었다.
--
--   1. SECURITY DEFINER 인데 소유권 검사가 없다. 이 함수는 RLS 를 우회해서
--      도니까, 프로젝트 UUID 하나만 알면 **남의 발주서를 통째로 덮어쓸 수**
--      있었다. boq_tables 를 DELETE 하고 새로 넣는 함수라 피해가 복구도 안 된다.
--   2. EXECUTE 가 PUBLIC 에 열려 있다 (CREATE FUNCTION 의 기본값). PostgREST
--      는 anon 롤로도 RPC 를 받아주므로 로그인조차 필요 없었다.
--   3. search_path 가 없다. DEFINER 권한으로 도는 함수에서 스키마를 안 고정하면
--      호출자가 search_path 를 바꿔 같은 이름의 테이블을 끼워넣을 수 있다.
--
-- 함수 본문은 20260728 과 같다 — 앞에 권한 검사만 붙었다. CREATE OR REPLACE
-- 는 본문 전체를 요구하므로 통째로 다시 쓴다.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_purchase_order(
  p_project_id uuid,
  p_tables jsonb  -- [{id, template_id, label, sort_order, items: [{id, name, material, ...exclusions: [...]}]}]
) RETURNS uuid AS $$
DECLARE
  v_po_id uuid;
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

  -- 1. purchase_order upsert
  INSERT INTO purchase_orders (project_id, updated_at)
  VALUES (p_project_id, now())
  ON CONFLICT (project_id)
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_po_id;

  -- 2. 기존 데이터 삭제 (CASCADE로 items/exclusions도 삭제)
  DELETE FROM boq_tables WHERE purchase_order_id = v_po_id;

  -- 3. 새 데이터 삽입
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

      -- exclusions
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

  RETURN v_po_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 로그인한 사용자만 호출할 수 있게 한다. PUBLIC 에 남아 있으면 anon 키로도
-- 부를 수 있고, 그러면 위의 auth.uid() 검사까지 가기 전에 이미 공격면이 열린다.
REVOKE ALL ON FUNCTION public.sync_purchase_order(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_purchase_order(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_purchase_order(uuid, jsonb) TO authenticated;

-- ── handle_new_user: search_path 고정 ──
--
-- auth.users 트리거라 가입할 때마다 DEFINER 권한으로 돈다. search_path 가
-- 비어 있으면 public.profiles 를 가리키는 이름이 호출 환경에 따라 달라질 수
-- 있다. 본문은 20260725 와 같다.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
