SELECT t.typname, string_agg(e.enumlabel, ', ' ORDER BY e.enumlabel) as values
FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname IN (
  'allergy_severity','patient_condition_status','controlled_substance_schedule',
  'inventory_batch_status','dispatch_offer_status','dispatch_job_status',
  'dispatch_assignment_status','pharmacy_delivery_status','driver_availability_status',
  'driver_earning_type','proof_kind','health_alert_severity','health_alert_state',
  'health_threshold_comparator','ai_message_role','ai_artifact_type','ai_review_status',
  'ai_risk_level','ai_generation_status','clinical_note_status','message_type',
  'verification_document_kind'
)
GROUP BY t.typname ORDER BY t.typname;
