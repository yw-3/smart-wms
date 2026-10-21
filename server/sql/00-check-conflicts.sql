-- ============================================================
-- 第 1 步：体检查询（只读，不改任何东西）
-- 把结果发给我，我来判断这个 Supabase 项目能不能直接复用。
-- ============================================================

SELECT
  t.table_name AS 表名,
  CASE
    WHEN t.table_name IN ('users','suppliers','locations','units','materials',
                          'operation_logs','inbound_orders','batch_inventory','stock',
                          'products','bom','production_lines',
                          'requisition_orders','requisition_items')
      THEN '⚠️ 与WMS同名（需核对结构是否一致）'
    ELSE '其他任务的表（保留不动）'
  END AS 判定
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name;

-- 如果上面没有结果行 = 该项目是空库，直接跑 schema.pg.sql 即可。
-- 如果存在 ⚠️ 的表名（尤其是 users），请不要建表，告诉我，我会给你「新建独立项目」的方案。
