SELECT t.typname, string_agg(e.enumlabel, ', ' ORDER BY e.enumlabel) as values
FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname IN ('emergency_unit_status')
GROUP BY t.typname;
