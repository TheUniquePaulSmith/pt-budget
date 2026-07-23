export interface SampleQuery {
  title: string;
  query: string;
}

export const SAMPLE_QUERIES: SampleQuery[] = [
  {
    title: 'All Transactions',
    query: 'SELECT * FROM transactions ORDER BY date DESC LIMIT 10;',
  },
  {
    title: 'Transaction Summary by Category',
    query: `SELECT
  c.name as category,
  t.type,
  COUNT(*) as transaction_count,
  SUM(ABS(t.amount)) as total_amount
FROM transactions t
LEFT JOIN categories c ON t.category_id = c.id
GROUP BY c.name, t.type
ORDER BY total_amount DESC;`,
  },
  {
    title: 'Monthly Spending Totals',
    query: `SELECT
  strftime('%Y-%m', date) as month,
  SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
  SUM(CASE WHEN type = 'expense' THEN ABS(amount) ELSE 0 END) as expenses
FROM transactions
GROUP BY strftime('%Y-%m', date)
ORDER BY month DESC;`,
  },
  {
    title: 'Top 10 Expense Categories',
    query: `SELECT
  c.name as category,
  COUNT(*) as transaction_count,
  SUM(ABS(t.amount)) as total_spent
FROM transactions t
LEFT JOIN categories c ON t.category_id = c.id
WHERE t.type = 'expense'
GROUP BY c.id, c.name
ORDER BY total_spent DESC
LIMIT 10;`,
  },
  {
    title: 'Database Schema - Tables',
    query: `SELECT
  name as table_name,
  type
FROM sqlite_master
WHERE type IN ('table', 'view')
ORDER BY name;`,
  },
  {
    title: 'Database Schema - Columns',
    query: `SELECT
  m.name as table_name,
  p.name as column_name,
  p.type as data_type,
  p.[notnull] as not_null,
  p.pk as primary_key
FROM sqlite_master m
LEFT OUTER JOIN pragma_table_info(m.name) p
WHERE m.type = 'table'
ORDER BY m.name, p.cid;`,
  },
];
