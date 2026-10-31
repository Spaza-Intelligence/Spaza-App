-- Low-stock products
SELECT name, quantity_on_hand, minimum_stock
FROM products
WHERE shop_id = '11111111-1111-1111-1111-111111111111'
  AND quantity_on_hand <= minimum_stock
ORDER BY quantity_on_hand;

-- Sales totals by day
SELECT DATE(sold_at) AS sale_date, SUM(total) AS total_sales
FROM sales
WHERE status = 'COMPLETED'
GROUP BY DATE(sold_at)
ORDER BY sale_date DESC;

-- Best-selling products
SELECT p.name, SUM(si.quantity) AS units_sold, SUM(si.line_total) AS revenue
FROM sale_items si
JOIN sales s ON s.id = si.sale_id
JOIN products p ON p.id = si.product_id
WHERE s.status = 'COMPLETED'
GROUP BY p.name
ORDER BY units_sold DESC;

-- Current stock value at cost price
SELECT SUM(quantity_on_hand * cost_price) AS stock_cost_value
FROM products
WHERE active = TRUE;
