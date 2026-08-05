-- BOQ 품목에 산출방식(calcMethod) 관련 컬럼 추가
-- area(면적), length(길이), quantity(수량) 3가지 방식 지원

ALTER TABLE boq_items
  ADD COLUMN IF NOT EXISTS calc_method text NOT NULL DEFAULT 'area',
  ADD COLUMN IF NOT EXISTS length_m    numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_qty  numeric NOT NULL DEFAULT 0;

-- 기존 데이터는 모두 area 방식이므로 DEFAULT로 충분
-- calc_method 값 제한 (CHECK constraint)
ALTER TABLE boq_items
  ADD CONSTRAINT boq_items_calc_method_check
  CHECK (calc_method IN ('area', 'length', 'quantity'));

COMMENT ON COLUMN boq_items.calc_method IS '산출방식: area(면적), length(길이), quantity(수량)';
COMMENT ON COLUMN boq_items.length_m    IS '길이 산출 시 길이값 (m)';
COMMENT ON COLUMN boq_items.manual_qty  IS '수량 산출 시 직접 입력 수량';
