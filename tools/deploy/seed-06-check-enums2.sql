SELECT t.typname, string_agg(e.enumlabel, ', ' ORDER BY e.enumlabel) as values
FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname IN ('stored_object_status','malware_scan_state','support_ticket_status','support_ticket_priority','broadcast_status','broadcast_audience','notification_category')
GROUP BY t.typname ORDER BY t.typname;
