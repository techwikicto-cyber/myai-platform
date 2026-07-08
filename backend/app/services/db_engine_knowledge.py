"""
Built-in reference knowledge for each supported database engine.
Injected directly into the LLM query-generation prompt — no embeddings,
no upload, no dependency on any external service.
"""

from app.models.db_connection import DbEngine

_POSTGRES = """
## راهنمای سینتکس PostgreSQL (فقط SELECT)

### محدودسازی و صفحه‌بندی
SELECT ... FROM t LIMIT 50 OFFSET 0;

### توابع تاریخ/زمان
NOW(), CURRENT_DATE, CURRENT_TIMESTAMP
DATE_TRUNC('month', col)          -- اول ماه
EXTRACT(YEAR FROM col)
col::date                         -- تبدیل به تاریخ
AGE(timestamp1, timestamp2)       -- فاصله زمانی
TO_CHAR(col, 'YYYY-MM-DD')

### رشته‌ها
CONCAT(a, ' ', b)  یا  a || ' ' || b
LOWER(col), UPPER(col), TRIM(col)
SUBSTRING(col FROM 1 FOR 5)
REPLACE(col, 'old', 'new')
SPLIT_PART(col, ',', 1)           -- جداسازی با delimiter
REGEXP_REPLACE(col, pattern, rep)

### مقادیر null
COALESCE(col, 'پیش‌فرض')          -- اولین غیر-null
NULLIF(col, 0)                    -- اگر برابر 0 بود null برگردان

### توابع پنجره‌ای (Window Functions)
ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC)
RANK() / DENSE_RANK() OVER (...)
LAG(col, 1) OVER (ORDER BY date)  -- مقدار ردیف قبل
LEAD(col, 1) OVER (ORDER BY date) -- مقدار ردیف بعد
SUM(col) OVER (PARTITION BY grp)  -- جمع تجمعی

### JSON/JSONB
col->'key'                        -- دسترسی به key (JSON)
col->>'key'                       -- مقدار متن (JSONB)
col#>>'{a,b}'                     -- مسیر تودرتو
jsonb_array_elements(col)         -- باز کردن آرایه
col @> '{"key":"val"}'::jsonb     -- شامل‌بودن

### CTE و Subquery
WITH cte AS (SELECT ...) SELECT * FROM cte;
WITH RECURSIVE cte AS (base UNION ALL recursive_part) SELECT * FROM cte;

### آمار
COUNT(*), COUNT(DISTINCT col)
SUM, AVG, MIN, MAX
PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY col)
STDDEV(col), VARIANCE(col)

### سایر
CASE WHEN ... THEN ... ELSE ... END
EXISTS (SELECT 1 FROM ...)
UNNEST(array_col)                 -- باز کردن آرایه به ردیف
GENERATE_SERIES(1, 10)            -- تولید بازه عددی
"""

_MYSQL = """
## راهنمای سینتکس MySQL / MariaDB (فقط SELECT)

### محدودسازی
SELECT ... FROM t LIMIT 50;
SELECT ... FROM t LIMIT 50 OFFSET 100;

### توابع تاریخ/زمان
NOW(), CURDATE(), CURTIME()
DATE_FORMAT(col, '%Y-%m-%d')
DATE_ADD(col, INTERVAL 7 DAY)
DATEDIFF(date1, date2)            -- تفاوت روز
YEAR(col), MONTH(col), DAY(col)
TIMESTAMPDIFF(MONTH, d1, d2)

### رشته‌ها
CONCAT(a, b, c)                   -- جمع رشته (|| کار نمی‌کند)
GROUP_CONCAT(col SEPARATOR ', ')  -- جمع ردیف‌ها در یک رشته
SUBSTRING(col, 1, 5)
TRIM / LTRIM / RTRIM
REPLACE(col, 'old', 'new')
REGEXP col LIKE 'pattern'         -- regex

### مقادیر null
IFNULL(col, 'پیش‌فرض')
COALESCE(a, b, c)
NULLIF(col, 0)

### توابع پنجره‌ای (MySQL ≥ 8.0)
ROW_NUMBER() OVER (PARTITION BY col ORDER BY col2)
RANK(), DENSE_RANK(), NTILE(n)
LAG(col) OVER (...), LEAD(col) OVER (...)

### آمار
COUNT(*), COUNT(DISTINCT col)
SUM, AVG, MIN, MAX
STD(col), VARIANCE(col)

### نکات مهم
- رشته‌ها با '' یا "" (حالت ANSI) — ترجیحاً ''
- نام‌های با کلمه کلیدی را با `backtick` احاطه کن: `order`, `group`
- BOOLEAN: TRUE/FALSE یا 1/0
- JSON: JSON_EXTRACT(col, '$.key')  یا  col->>'$.key' (MySQL 8)

### CTE
WITH cte AS (SELECT ...) SELECT * FROM cte;  -- (MySQL ≥ 8.0)
"""

_MSSQL = """
## راهنمای سینتکس SQL Server / MSSQL (فقط SELECT)

### محدودسازی
SELECT TOP 50 * FROM t;
SELECT * FROM t ORDER BY id OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY;

### توابع تاریخ/زمان
GETDATE(), GETUTCDATE(), SYSDATETIMEOFFSET()
DATEPART(YEAR, col) / DATEPART(MONTH, col) / DATEPART(DAY, col)
DATEDIFF(DAY, date1, date2)
DATEADD(DAY, 7, col)
FORMAT(col, 'yyyy-MM-dd')
CONVERT(DATE, col)  /  CAST(col AS DATE)
EOMONTH(col)                      -- آخر ماه

### رشته‌ها
col1 + ' ' + col2                 -- جمع رشته (+ نه ||)
LEN(col)                          -- طول (نه LENGTH)
SUBSTRING(col, 1, 5)
CHARINDEX('x', col)               -- موقعیت زیررشته
REPLACE(col, 'old', 'new')
TRIM / LTRIM / RTRIM
STRING_AGG(col, ', ')             -- معادل GROUP_CONCAT (SQL 2017+)

### مقادیر null
ISNULL(col, 'پیش‌فرض')            -- معادل IFNULL/NVL
COALESCE(a, b, c)
NULLIF(col, 0)

### توابع پنجره‌ای
ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC)
RANK(), DENSE_RANK(), NTILE(n)
LAG(col, 1, 0) OVER (ORDER BY date)
LEAD(col, 1, 0) OVER (ORDER BY date)
SUM(col) OVER (PARTITION BY grp ORDER BY date ROWS UNBOUNDED PRECEDING)

### نکات مهم
- نام اشیاء با [brackets] اگر keyword هستند: [order], [user]
- بدون LIMIT — همیشه TOP یا OFFSET/FETCH استفاده کن
- NULL مقایسه: IS NULL / IS NOT NULL (نه = NULL)
- BOOLEAN وجود ندارد — از BIT (0/1) استفاده می‌شود
- NOLOCK hint برای خواندن بدون lock: SELECT ... FROM t WITH (NOLOCK)

### CTE و Subquery
WITH cte AS (SELECT ...) SELECT * FROM cte;
WITH cte1 AS (...), cte2 AS (...) SELECT ...;
"""

_ORACLE = """
## راهنمای سینتکس Oracle Database (فقط SELECT)

### محدودسازی (Oracle ≥ 12c)
SELECT * FROM t FETCH FIRST 50 ROWS ONLY;
SELECT * FROM t ORDER BY id OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY;
-- روش قدیمی (Oracle 11g):
SELECT * FROM (SELECT ...) WHERE ROWNUM <= 50;

### توابع تاریخ/زمان
SYSDATE                           -- تاریخ و زمان جاری
CURRENT_DATE, CURRENT_TIMESTAMP
TRUNC(SYSDATE, 'MM')              -- اول ماه
TRUNC(SYSDATE, 'YYYY')            -- اول سال
ADD_MONTHS(col, 3)
MONTHS_BETWEEN(d1, d2)
TO_DATE('2024-01-01', 'YYYY-MM-DD')
TO_CHAR(col, 'YYYY-MM-DD HH24:MI:SS')
EXTRACT(YEAR FROM col)

### رشته‌ها
col1 || ' ' || col2               -- جمع رشته
LENGTH(col)
SUBSTR(col, 1, 5)
INSTR(col, 'x')                   -- موقعیت زیررشته
REPLACE(col, 'old', 'new')
TRIM / LTRIM / RTRIM
REGEXP_REPLACE(col, pattern, rep)
LISTAGG(col, ', ') WITHIN GROUP (ORDER BY col)  -- معادل GROUP_CONCAT

### مقادیر null
NVL(col, 'پیش‌فرض')               -- معادل ISNULL
NVL2(col, val_not_null, val_null)
COALESCE(a, b, c)
NULLIF(col, 0)

### توابع decode/case
DECODE(col, val1, res1, val2, res2, default_res)
CASE WHEN ... THEN ... ELSE ... END

### توابع پنجره‌ای
ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC)
RANK(), DENSE_RANK(), NTILE(n)
LAG(col, 1, 0) OVER (ORDER BY date)
LEAD(col, 1, 0) OVER (ORDER BY date)

### نکات مهم
- برای select بدون جدول: SELECT 1 FROM DUAL
- ROWNUM در WHERE قبل از ORDER BY اعمال می‌شود — برای pagination از subquery استفاده کن
- رشته‌ها فقط با '' (نه "")
- BOOLEAN وجود ندارد — از NUMBER(1) یا CHAR(1) استفاده می‌شود
- NULL + هر چیز = NULL

### CTE
WITH cte AS (SELECT ...) SELECT * FROM cte;
"""

_MONGODB = """
## راهنمای سینتکس MongoDB (فقط خواندنی — find/aggregate)

### فرمت ارسال کوئری
{"operation":"find","collection":"نام_کالکشن","filter":{...},"projection":{...},"sort":{...},"limit":50}
{"operation":"aggregate","collection":"نام_کالکشن","pipeline":[...]}

### عملگرهای فیلتر (filter)
{"field": "value"}                          -- برابری
{"field": {"$gt": 10}}                      -- بزرگتر از
{"field": {"$gte": 10, "$lte": 100}}        -- بازه
{"field": {"$in": ["a","b","c"]}}           -- یکی از لیست
{"field": {"$nin": ["x"]}}                  -- هیچکدام از لیست
{"field": {"$ne": null}}                    -- نابرابر
{"field": {"$exists": true}}                -- وجود فیلد
{"field": {"$regex": "^pattern"}}           -- regex
{"$and": [{...},{...}]}
{"$or":  [{...},{...}]}
{"$not": {field: {op: val}}}
{"nested.field": "value"}                   -- فیلد تودرتو

### Aggregation Pipeline مراحل رایج
$match    -- فیلتر (مثل WHERE)
$group    -- گروه‌بندی
$sort     -- مرتب‌سازی
$project  -- انتخاب/تبدیل فیلدها
$limit    -- محدودسازی تعداد
$skip     -- جمپ از ابتدا (pagination)
$unwind   -- باز کردن آرایه به ردیف
$lookup   -- join با کالکشن دیگر
$count    -- شمارش
$addFields -- افزودن فیلد محاسبه‌شده

### مثال‌های aggregate
# شمارش گروهی
{"operation":"aggregate","collection":"orders","pipeline":[
  {"$match": {"status": "completed"}},
  {"$group": {"_id": "$customer_id", "total": {"$sum": "$amount"}, "count": {"$sum": 1}}},
  {"$sort": {"total": -1}},
  {"$limit": 10}
]}

# join دو کالکشن
{"operation":"aggregate","collection":"orders","pipeline":[
  {"$lookup": {"from":"users","localField":"user_id","foreignField":"_id","as":"user"}},
  {"$unwind": "$user"},
  {"$project": {"order_id":1, "user.name":1, "amount":1}}
]}

### عملگرهای $group
$sum, $avg, $min, $max
$push                             -- جمع مقادیر در آرایه
$addToSet                         -- مقادیر منحصربه‌فرد
$first, $last                     -- اولین/آخرین مقدار در گروه
$count: {"$sum": 1}               -- شمارش

### نکات مهم
- فقط find و aggregate مجاز است — update/delete/insert/drop مجاز نیست
- ObjectId: {"$oid": "..."} یا رشته متنی (بسته به ساختار داده)
- تاریخ: {"$date": "2024-01-01T00:00:00Z"}
- همیشه limit را در find تنظیم کن
"""


_ENGINE_MAP: dict[DbEngine, str] = {
    DbEngine.postgres: _POSTGRES,
    DbEngine.mysql: _MYSQL,
    DbEngine.mssql: _MSSQL,
    DbEngine.oracle: _ORACLE,
    DbEngine.mongodb: _MONGODB,
}


def get_engine_knowledge(engine: DbEngine) -> str:
    """Return the built-in reference cheatsheet for the given database engine."""
    return _ENGINE_MAP.get(engine, "")
