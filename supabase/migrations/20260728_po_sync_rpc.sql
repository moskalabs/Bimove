-- PO 동기화를 단일 트랜잭션으로 처리하는 RPC 함수
-- DELETE + INSERT가 원자적으로 실행되어 중간 실패 시 데이터 손실 방지

CREATE OR REPLACE FUNCTION sync_purchase_order(
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
