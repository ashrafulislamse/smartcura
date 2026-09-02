-- Apply the value-range and unit CHECK constraints for the activity/wellness
-- metrics added in migration 0056. This is deliberately separate so the
-- newly-added enum labels are usable in the comparison expressions.

ALTER TABLE "vital_readings" DROP CONSTRAINT "vital_readings_value_range_check";
ALTER TABLE "vital_readings" ADD CONSTRAINT "vital_readings_value_range_check" CHECK (
  ("metric" = 'heart_rate' AND "value" > 0 AND "value" <= 300)
  OR ("metric" = 'oxygen_saturation' AND "value" >= 0 AND "value" <= 100)
  OR ("metric" = 'body_temperature' AND "value" >= 20 AND "value" <= 45)
  OR ("metric" = 'blood_pressure' AND "value" > 0 AND "value" <= 300)
  OR ("metric" = 'systolic_bp' AND "value" > 0 AND "value" <= 300)
  OR ("metric" = 'diastolic_bp' AND "value" > 0 AND "value" <= 200)
  OR ("metric" = 'respiratory_rate' AND "value" > 0 AND "value" <= 120)
  OR ("metric" = 'blood_glucose' AND "value" > 0 AND "value" <= 1000)
  OR ("metric" = 'body_weight' AND "value" > 0 AND "value" <= 500)
  OR ("metric" = 'ecg_voltage' AND "value" >= -50 AND "value" <= 50)
  OR ("metric" = 'steps' AND "value" >= 0 AND "value" <= 100000)
  OR ("metric" = 'distance' AND "value" >= 0 AND "value" <= 100000)
  OR ("metric" = 'active_energy' AND "value" >= 0 AND "value" <= 50000)
  OR ("metric" = 'basal_energy' AND "value" >= 0 AND "value" <= 50000)
  OR ("metric" = 'sleep_duration' AND "value" >= 0 AND "value" <= 24)
);

ALTER TABLE "vital_readings" DROP CONSTRAINT "vital_readings_unit_check";
ALTER TABLE "vital_readings" ADD CONSTRAINT "vital_readings_unit_check" CHECK (
  ("metric" = 'heart_rate' AND "unit" = '/min')
  OR ("metric" = 'oxygen_saturation' AND "unit" = '%')
  OR ("metric" = 'body_temperature' AND "unit" = 'Cel')
  OR ("metric" IN ('blood_pressure', 'systolic_bp', 'diastolic_bp') AND "unit" = 'mm[Hg]')
  OR ("metric" = 'respiratory_rate' AND "unit" = '/min')
  OR ("metric" = 'blood_glucose' AND "unit" = 'mg/dL')
  OR ("metric" = 'body_weight' AND "unit" = 'kg')
  OR ("metric" = 'ecg_voltage' AND "unit" = 'mV')
  OR ("metric" = 'steps' AND "unit" = 'count')
  OR ("metric" = 'distance' AND "unit" = 'm')
  OR ("metric" IN ('active_energy', 'basal_energy') AND "unit" = 'kcal')
  OR ("metric" = 'sleep_duration' AND "unit" = 'h')
);
