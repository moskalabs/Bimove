-- ============================================================
-- bimove RLS (Row Level Security) 정책
-- 모든 테이블에서 본인 데이터만 접근 가능하도록 설정
--
-- 적용 방법: Supabase Dashboard > SQL Editor에서 실행
-- 이미 적용된 정책이 있으면 DROP POLICY 후 재생성
-- ============================================================

-- ── 1. profiles ──
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ── 2. projects ──
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own projects" ON public.projects;
CREATE POLICY "Users can view own projects"
  ON public.projects FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own projects" ON public.projects;
CREATE POLICY "Users can insert own projects"
  ON public.projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own projects" ON public.projects;
CREATE POLICY "Users can update own projects"
  ON public.projects FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own projects" ON public.projects;
CREATE POLICY "Users can delete own projects"
  ON public.projects FOR DELETE
  USING (auth.uid() = user_id);

-- ── 3. purchase_orders (project_id → projects.user_id 체인) ──
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own purchase_orders" ON public.purchase_orders;
CREATE POLICY "Users can manage own purchase_orders"
  ON public.purchase_orders FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = purchase_orders.project_id
        AND projects.user_id = auth.uid()
    )
  );

-- ── 4. boq_tables (purchase_order_id → purchase_orders → projects 체인) ──
ALTER TABLE public.boq_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own boq_tables" ON public.boq_tables;
CREATE POLICY "Users can manage own boq_tables"
  ON public.boq_tables FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.purchase_orders po
      JOIN public.projects p ON p.id = po.project_id
      WHERE po.id = boq_tables.purchase_order_id
        AND p.user_id = auth.uid()
    )
  );

-- ── 5. boq_items (boq_table_id → boq_tables → ... 체인) ──
ALTER TABLE public.boq_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own boq_items" ON public.boq_items;
CREATE POLICY "Users can manage own boq_items"
  ON public.boq_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.boq_tables bt
      JOIN public.purchase_orders po ON po.id = bt.purchase_order_id
      JOIN public.projects p ON p.id = po.project_id
      WHERE bt.id = boq_items.boq_table_id
        AND p.user_id = auth.uid()
    )
  );

-- ── 6. boq_exclusions ──
ALTER TABLE public.boq_exclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own boq_exclusions" ON public.boq_exclusions;
CREATE POLICY "Users can manage own boq_exclusions"
  ON public.boq_exclusions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.boq_items bi
      JOIN public.boq_tables bt ON bt.id = bi.boq_table_id
      JOIN public.purchase_orders po ON po.id = bt.purchase_order_id
      JOIN public.projects p ON p.id = po.project_id
      WHERE bi.id = boq_exclusions.boq_item_id
        AND p.user_id = auth.uid()
    )
  );

-- ── 7. price_configs ──
ALTER TABLE public.price_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own price_configs" ON public.price_configs;
CREATE POLICY "Users can manage own price_configs"
  ON public.price_configs FOR ALL
  USING (auth.uid() = user_id);

-- ── 8. Auto-create profile on signup ──
-- (trigger: auth.users → profiles 자동 생성)
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
