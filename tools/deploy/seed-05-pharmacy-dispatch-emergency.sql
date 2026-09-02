-- SmartCura Demo Data Seed Script
-- Part 5: Pharmacy orders, dispatch, drivers, emergency, AI, verification, reviews

BEGIN;

-- Org ID: 018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10
-- Site ID: 018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11

-- ============================================================================
-- 1. PHARMACY ORDERS (various lifecycle stages)
-- ============================================================================

-- Order 1: fulfilled/delivered (from prescription 1 - Paracetamol)
INSERT INTO pharmacy_orders (pharmacy_order_id, organization_id, site_id, patient_profile_id, prescription_id, status, version, created_at, updated_at)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11',
  p.patient_profile_id, p.prescription_id,
  'delivered'::pharmacy_order_status, 1,
  now() - interval '2 days', now() - interval '1 day'
FROM prescriptions p
JOIN consultations c ON p.consultation_id = c.consultation_id
WHERE c.consultation_id = '019ffdcb-9284-7a25-8c9e-3b6153b15b51';

-- Order 1 items
INSERT INTO pharmacy_order_items (order_item_id, pharmacy_order_id, variant_id, position, quantity, unit_price_sen)
SELECT uuidv7(), po.pharmacy_order_id, mv.variant_id, 1, 20, 200
FROM pharmacy_orders po
JOIN prescriptions p ON po.prescription_id = p.prescription_id
JOIN consultations c ON p.consultation_id = c.consultation_id
CROSS JOIN medication_variants mv
JOIN medications m ON mv.medication_id = m.medication_id
WHERE c.consultation_id = '019ffdcb-9284-7a25-8c9e-3b6153b15b51'
  AND m.generic_name = 'Paracetamol' AND mv.brand_name = 'Panadol';

-- Order 2: dispatched (from prescription 2 - Metformin + Amlodipine)
INSERT INTO pharmacy_orders (pharmacy_order_id, organization_id, site_id, patient_profile_id, prescription_id, status, version, created_at, updated_at)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11',
  p.patient_profile_id, p.prescription_id,
  'dispatched'::pharmacy_order_status, 1,
  now() - interval '2 days' + interval '1 hour', now() - interval '6 hours'
FROM prescriptions p
JOIN consultations c ON p.consultation_id = c.consultation_id
WHERE c.consultation_id = '019ffdd6-1bd3-7fda-ba4c-27cf43921209';

-- Order 2 items - Metformin
INSERT INTO pharmacy_order_items (order_item_id, pharmacy_order_id, variant_id, position, quantity, unit_price_sen)
SELECT uuidv7(), po.pharmacy_order_id, mv.variant_id, 1, 60, 800
FROM pharmacy_orders po
JOIN prescriptions p ON po.prescription_id = p.prescription_id
JOIN consultations c ON p.consultation_id = c.consultation_id
CROSS JOIN medication_variants mv
JOIN medications m ON mv.medication_id = m.medication_id
WHERE c.consultation_id = '019ffdd6-1bd3-7fda-ba4c-27cf43921209'
  AND m.generic_name = 'Metformin' AND mv.brand_name = 'Glucophage';

-- Order 2 items - Amlodipine
INSERT INTO pharmacy_order_items (order_item_id, pharmacy_order_id, variant_id, position, quantity, unit_price_sen)
SELECT uuidv7(), po.pharmacy_order_id, mv.variant_id, 2, 30, 3000
FROM pharmacy_orders po
JOIN prescriptions p ON po.prescription_id = p.prescription_id
JOIN consultations c ON p.consultation_id = c.consultation_id
CROSS JOIN medication_variants mv
JOIN medications m ON mv.medication_id = m.medication_id
WHERE c.consultation_id = '019ffdd6-1bd3-7fda-ba4c-27cf43921209'
  AND m.generic_name = 'Amlodipine' AND mv.brand_name = 'Norvasc';

-- Order 3: received (new order, no prescription - over-the-counter Paracetamol for Farah)
INSERT INTO pharmacy_orders (pharmacy_order_id, organization_id, site_id, patient_profile_id, status, version, created_at)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11',
  p.profile_id, 'received'::pharmacy_order_status, 0,
  now() - interval '3 hours'
FROM profiles p WHERE p.display_name = 'Farah Natasya Yusof';

-- Order 3 items - Paracetamol (OTC)
INSERT INTO pharmacy_order_items (order_item_id, pharmacy_order_id, variant_id, position, quantity, unit_price_sen)
SELECT uuidv7(), po.pharmacy_order_id, mv.variant_id, 1, 10, 200
FROM pharmacy_orders po
CROSS JOIN medication_variants mv
JOIN medications m ON mv.medication_id = m.medication_id
WHERE po.status = 'received'::pharmacy_order_status
  AND m.generic_name = 'Paracetamol' AND mv.brand_name = 'Panadol'
  AND po.patient_profile_id = (SELECT profile_id FROM profiles WHERE display_name = 'Farah Natasya Yusof');

-- ============================================================================
-- 2. DRIVER SETUP
-- ============================================================================

-- Create driver record for Rajesh Kumar (existing driver membership)
INSERT INTO drivers (driver_id, membership_id, profile_id, organization_id, availability, version)
SELECT uuidv7(), om.membership_id, om.profile_id, om.organization_id,
  'available'::driver_availability_status, 0
FROM organization_memberships om
JOIN profiles p ON om.profile_id = p.profile_id
WHERE p.display_name = 'Rajesh Kumar' AND om.role_id = 'driver';

-- Create driver record for Lee Chee Keong
INSERT INTO drivers (driver_id, membership_id, profile_id, organization_id, availability, version)
SELECT uuidv7(), om.membership_id, om.profile_id, om.organization_id,
  'offline'::driver_availability_status, 0
FROM organization_memberships om
JOIN profiles p ON om.profile_id = p.profile_id
WHERE p.display_name = 'Lee Chee Keong' AND om.role_id = 'driver';

-- Driver bank account for Rajesh
INSERT INTO driver_bank_accounts (bank_account_id, driver_id, bank_code, account_last4, account_hash, verified_at, active)
SELECT uuidv7(), dr.driver_id, 'MBB', '4321',
  encode(digest('MBB-1234564321', 'sha256'), 'hex'),
  now() - interval '30 days', true
FROM drivers dr
JOIN profiles p ON dr.profile_id = p.profile_id
WHERE p.display_name = 'Rajesh Kumar';

-- Vehicle for Rajesh
INSERT INTO vehicles (vehicle_id, driver_id, plate_number, vehicle_type, active, version)
SELECT uuidv7(), dr.driver_id, 'WXY 1234', 'car', true, 0
FROM drivers dr
JOIN profiles p ON dr.profile_id = p.profile_id
WHERE p.display_name = 'Rajesh Kumar';

-- ============================================================================
-- 3. DISPATCH JOB + OFFER + ASSIGNMENT + DELIVERY for Order 1 (delivered)
-- ============================================================================

-- Dispatch job for delivered order
INSERT INTO dispatch_jobs (dispatch_job_id, organization_id, site_id, reference_type, reference_id, status, fee_sen, currency, version, created_at, updated_at)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11',
  'pharmacy_order', po.pharmacy_order_id,
  'completed'::dispatch_job_status, 500, 'MYR', 1,
  now() - interval '2 days', now() - interval '1 day'
FROM pharmacy_orders po
WHERE po.status = 'delivered'::pharmacy_order_status;

-- Dispatch offer (accepted) from Rajesh
INSERT INTO dispatch_offers (offer_id, dispatch_job_id, driver_id, status, fee_sen, approx_distance_metres, expires_at, responded_at, version, created_at, updated_at)
SELECT uuidv7(), dj.dispatch_job_id, dr.driver_id,
  'accepted'::dispatch_offer_status, 500, 5200,
  now() - interval '2 days' + interval '20 minutes',
  now() - interval '2 days' + interval '5 minutes', 1,
  now() - interval '2 days', now() - interval '2 days' + interval '5 minutes'
FROM dispatch_jobs dj
CROSS JOIN drivers dr
JOIN profiles p ON dr.profile_id = p.profile_id
WHERE p.display_name = 'Rajesh Kumar' AND dj.status = 'completed'::dispatch_job_status;

-- Dispatch assignment (completed)
INSERT INTO dispatch_assignments (assignment_id, dispatch_job_id, driver_id, vehicle_id, offer_id, status, assigned_at, completed_at, version, updated_at)
SELECT uuidv7(), dj.dispatch_job_id, dr.driver_id,
  (SELECT vehicle_id FROM vehicles v JOIN drivers d ON v.driver_id = d.driver_id JOIN profiles p ON d.profile_id = p.profile_id WHERE p.display_name = 'Rajesh Kumar'),
  doffer.offer_id,
  'completed'::dispatch_assignment_status,
  now() - interval '2 days' + interval '5 minutes',
  now() - interval '1 day', 1,
  now() - interval '1 day'
FROM dispatch_jobs dj
CROSS JOIN drivers dr
JOIN profiles p ON dr.profile_id = p.profile_id
CROSS JOIN dispatch_offers doffer
WHERE p.display_name = 'Rajesh Kumar' AND dj.status = 'completed'::dispatch_job_status
  AND doffer.dispatch_job_id = dj.dispatch_job_id;

-- Delivery record (delivered)
INSERT INTO deliveries (delivery_id, pharmacy_order_id, dispatch_job_id, status, recipient_name, recipient_phone_e164, address_line1, address_line2, postcode, city, state_code, latitude, longitude, version, created_at, updated_at)
SELECT uuidv7(), po.pharmacy_order_id, dj.dispatch_job_id,
  'delivered'::pharmacy_delivery_status,
  'Arif Hossain', '+60123456710',
  'Unit 12-3A, Residensi Sinar', 'Jalan Ampang', '55000', 'Kuala Lumpur', 'WPKL',
  3.1585, 101.7230, 1,
  now() - interval '2 days' + interval '5 minutes', now() - interval '1 day'
FROM pharmacy_orders po
CROSS JOIN dispatch_jobs dj
WHERE po.status = 'delivered'::pharmacy_order_status
  AND dj.reference_type = 'pharmacy_order' AND dj.reference_id = po.pharmacy_order_id;

-- Delivery proof (signature code)
INSERT INTO delivery_proofs (delivery_proof_id, delivery_id, assignment_id, kind, code_hash, captured_at)
SELECT uuidv7(), dl.delivery_id, da.assignment_id,
  'code'::proof_kind,
  encode(digest('4521', 'sha256'), 'hex'),
  now() - interval '1 day'
FROM deliveries dl
JOIN dispatch_assignments da ON da.dispatch_job_id = dl.dispatch_job_id
WHERE dl.status = 'delivered'::pharmacy_delivery_status;

-- Delivery rating (5 stars)
INSERT INTO delivery_ratings (rating_id, delivery_id, driver_id, stars)
SELECT uuidv7(), dl.delivery_id, dr.driver_id, 5
FROM deliveries dl
JOIN drivers dr ON dr.driver_id = (SELECT driver_id FROM dispatch_assignments WHERE dispatch_job_id = dl.dispatch_job_id LIMIT 1)
WHERE dl.status = 'delivered'::pharmacy_delivery_status;

-- Driver earning event
INSERT INTO driver_earning_events (earning_event_id, driver_id, assignment_id, earning_type, amount_sen, currency, reason_code, correlation_id, occurred_at)
SELECT uuidv7(), dr.driver_id, da.assignment_id,
  'delivery_fee'::driver_earning_type, 500, 'MYR', 'delivery_completed',
  uuidv7(), now() - interval '1 day'
FROM drivers dr
JOIN dispatch_assignments da ON da.driver_id = dr.driver_id
JOIN profiles p ON dr.profile_id = p.profile_id
WHERE p.display_name = 'Rajesh Kumar';

-- ============================================================================
-- 4. DISPATCH for Order 2 (in transit)
-- ============================================================================

-- Dispatch job for dispatched order
INSERT INTO dispatch_jobs (dispatch_job_id, organization_id, site_id, reference_type, reference_id, status, fee_sen, currency, version, created_at, updated_at)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11',
  'pharmacy_order', po.pharmacy_order_id,
  'in_progress'::dispatch_job_status, 500, 'MYR', 0,
  now() - interval '6 hours', now() - interval '3 hours'
FROM pharmacy_orders po
WHERE po.status = 'dispatched'::pharmacy_order_status;

-- Dispatch offer (accepted) from Rajesh
INSERT INTO dispatch_offers (offer_id, dispatch_job_id, driver_id, status, fee_sen, approx_distance_metres, expires_at, responded_at, version, created_at, updated_at)
SELECT uuidv7(), dj.dispatch_job_id, dr.driver_id,
  'accepted'::dispatch_offer_status, 500, 3800,
  now() - interval '6 hours' + interval '20 minutes',
  now() - interval '6 hours' + interval '3 minutes', 1,
  now() - interval '6 hours', now() - interval '6 hours' + interval '3 minutes'
FROM dispatch_jobs dj
CROSS JOIN drivers dr
JOIN profiles p ON dr.profile_id = p.profile_id
WHERE p.display_name = 'Rajesh Kumar' AND dj.status = 'in_progress'::dispatch_job_status;

-- Dispatch assignment (en_route_dropoff)
INSERT INTO dispatch_assignments (assignment_id, dispatch_job_id, driver_id, vehicle_id, offer_id, status, assigned_at, version, updated_at)
SELECT uuidv7(), dj.dispatch_job_id, dr.driver_id,
  (SELECT vehicle_id FROM vehicles v JOIN drivers d ON v.driver_id = d.driver_id JOIN profiles p ON d.profile_id = p.profile_id WHERE p.display_name = 'Rajesh Kumar'),
  doffer.offer_id,
  'en_route_dropoff'::dispatch_assignment_status,
  now() - interval '6 hours' + interval '3 minutes', 0,
  now() - interval '3 hours'
FROM dispatch_jobs dj
CROSS JOIN drivers dr
JOIN profiles p ON dr.profile_id = p.profile_id
CROSS JOIN dispatch_offers doffer
WHERE p.display_name = 'Rajesh Kumar' AND dj.status = 'in_progress'::dispatch_job_status
  AND doffer.dispatch_job_id = dj.dispatch_job_id;

-- Delivery record (in_transit)
INSERT INTO deliveries (delivery_id, pharmacy_order_id, dispatch_job_id, status, recipient_name, recipient_phone_e164, address_line1, address_line2, postcode, city, state_code, latitude, longitude, version, created_at, updated_at)
SELECT uuidv7(), po.pharmacy_order_id, dj.dispatch_job_id,
  'in_transit'::pharmacy_delivery_status,
  'Arif Hossain', '+60123456710',
  'Unit 12-3A, Residensi Sinar', 'Jalan Ampang', '55000', 'Kuala Lumpur', 'WPKL',
  3.1585, 101.7230, 0,
  now() - interval '6 hours' + interval '3 minutes', now() - interval '3 hours'
FROM pharmacy_orders po
CROSS JOIN dispatch_jobs dj
WHERE po.status = 'dispatched'::pharmacy_order_status
  AND dj.reference_type = 'pharmacy_order' AND dj.reference_id = po.pharmacy_order_id;

-- ============================================================================
-- 5. EMERGENCY EVENTS
-- ============================================================================

-- Emergency 1: resolved (Arif Hossain - chest pain)
INSERT INTO emergency_events (emergency_event_id, organization_id, site_id, patient_profile_id, reported_by_profile_id, status, triage_priority, category_code, latitude, longitude, address_text, triaged_at, dispatched_at, on_scene_at, resolved_at, version, created_at, updated_at)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11',
  p.profile_id, p.profile_id,
  'resolved'::emergency_event_status,
  'high'::triage_priority,
  'cardiac_symptoms',
  3.1585, 101.7230,
  'Unit 12-3A, Residensi Sinar, Jalan Ampang, Kuala Lumpur',
  now() - interval '5 days' + interval '10 minutes',
  now() - interval '5 days' + interval '20 minutes',
  now() - interval '5 days' + interval '35 minutes',
  now() - interval '5 days' + interval '90 minutes',
  1,
  now() - interval '5 days', now() - interval '5 days' + interval '90 minutes'
FROM profiles p WHERE p.display_name = 'Arif Hossain';

-- Emergency 2: on_scene (Farah Natasya - asthma attack)
INSERT INTO emergency_events (emergency_event_id, organization_id, site_id, patient_profile_id, reported_by_profile_id, status, triage_priority, category_code, latitude, longitude, address_text, triaged_at, dispatched_at, on_scene_at, version, created_at, updated_at)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11',
  p.profile_id, p.profile_id,
  'on_scene'::emergency_event_status,
  'medium'::triage_priority,
  'respiratory_distress',
  3.1340, 101.6200,
  '22, Jalan SS 21/1A, Damansara Utama, Petaling Jaya',
  now() - interval '1 hour' + interval '5 minutes',
  now() - interval '1 hour' + interval '15 minutes',
  now() - interval '30 minutes',
  1,
  now() - interval '1 hour', now() - interval '30 minutes'
FROM profiles p WHERE p.display_name = 'Farah Natasya Yusof';

-- Emergency 3: created (Mohammad Fahim - just triggered)
INSERT INTO emergency_events (emergency_event_id, organization_id, site_id, patient_profile_id, reported_by_profile_id, status, triage_priority, category_code, latitude, longitude, address_text, version, created_at)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11',
  p.profile_id, p.profile_id,
  'created'::emergency_event_status,
  'unknown'::triage_priority,
  'general_emergency',
  3.0730, 101.4660,
  'Block B-08-02, Apartment Sentral, Persiaran Klang, Shah Alam',
  0,
  now() - interval '5 minutes'
FROM profiles p WHERE p.display_name = 'Mohammad Fahim Ahmed';

-- ============================================================================
-- 6. EMERGENCY UNITS
-- ============================================================================

INSERT INTO emergency_units (emergency_unit_id, organization_id, site_id, call_sign, unit_type, status, capacity, version)
VALUES (uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11',
  'RRV-01', 'rapid_response_vehicle', 'available', 2, 0);

INSERT INTO emergency_units (emergency_unit_id, organization_id, site_id, call_sign, unit_type, status, capacity, version)
VALUES (uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11',
  'AMB-02', 'ambulance', 'on_scene', 4, 0);

INSERT INTO emergency_units (emergency_unit_id, organization_id, site_id, call_sign, unit_type, status, capacity, version)
VALUES (uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11',
  'MMT-03', 'mobile_medical_team', 'available', 6, 0);

COMMIT;
