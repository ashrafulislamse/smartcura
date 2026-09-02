import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  directorySortValue,
  normalizeReviewTags,
  serializeDoctor,
  type DoctorDirectoryRecord,
} from '../packages/database/src/doctor-discovery-repository.js';
import { DOCTOR_REVIEW_CHANGED_EVENT_TYPE } from '../packages/database/src/doctor-discovery-events.js';
import { OutboxProcessor } from '../apps/worker/src/outbox.processor.js';
import {
  saveDoctorReviewSchema,
  searchDoctorsSchema,
} from '../apps/api/src/doctor-discovery/doctor-discovery-request.schemas.js';

const doctorId='018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d20';
const profileId='018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d21';
const organizationId='018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d22';

test('doctor filters parse false correctly and reject unknown or invalid ranges',()=>{
  const parsed=searchDoctorsSchema.parse({accepts_new_patients:'false',min_rating:'4.5',sort:'rating'});
  assert.equal(parsed.accepts_new_patients,false);
  assert.equal(parsed.min_rating,4.5);
  assert.equal(searchDoctorsSchema.safeParse({min_rating:'0'}).success,false);
  assert.equal(searchDoctorsSchema.safeParse({unknown:'x'}).success,false);
});

test('review input enforces stars, bounded unique canonical tags and strict fields',()=>{
  assert.equal(saveDoctorReviewSchema.safeParse({expected_version:0,rating:5,comment:'Clear explanation',tags:['clear_explanation','on_time']}).success,true);
  assert.equal(saveDoctorReviewSchema.safeParse({expected_version:0,rating:6}).success,false);
  assert.equal(saveDoctorReviewSchema.safeParse({expected_version:0,rating:5,tags:['helpful','helpful']}).success,false);
  assert.deepEqual(normalizeReviewTags(['on_time','helpful','on_time']),['helpful','on_time']);
});

test('directory serialization exposes only approved public view fields with integer money',()=>{
  const record:DoctorDirectoryRecord={membershipId:doctorId,organizationId,profileId,displayName:'Dr Test',practiceName:'SmartCura Demo',biography:'General care',yearsExperience:8,consultationFeeSen:12000,currency:'MYR',acceptsNewPatients:true,specialties:['cardiology'],primarySpecialty:'cardiology',languages:['en'],ratingAverage:4.5,reviewCount:2,nextAvailableAt:new Date('2026-08-01T01:00:00.000Z')};
  const body=serializeDoctor(record);
  assert.equal(body.verified,true);
  assert.equal(body.image_url,null);
  assert.equal(body.consultation_fee_sen,12000);
  assert.equal('email' in body,false);
  assert.equal('phone_e164' in body,false);
  assert.equal('profile_id' in body,false);
  assert.equal(directorySortValue(record,'rating'),4.5);
});

test('review migration pins reviews to completed appointments and same participants',()=>{
  const sql=fs.readFileSync(new URL('../packages/database/drizzle/0017_doctor_discovery_and_reviews.sql',import.meta.url),'utf8');
  assert.match(sql,/doctor_reviews_appointment_participants_org_fk/);
  assert.match(sql,/status = 'completed'/);
  assert.match(sql,/doctor_reviews_appointment_uq/);
  const repository=fs.readFileSync(new URL('../packages/database/src/doctor-discovery-repository.ts',import.meta.url),'utf8');
  assert.match(repository,/membership\.verification_status = 'approved'/);
});

test('worker accepts minimum review event and rejects patient/comment disclosure',async()=>{
  const worker=new OutboxProcessor();
  assert.equal(await worker.process({eventId:doctorId,eventType:DOCTOR_REVIEW_CHANGED_EVENT_TYPE,eventVersion:1,attempts:1,payload:{review_id:doctorId,doctor_membership_id:doctorId,rating:5,change:'created'}}),true);
  assert.equal(await worker.process({eventId:doctorId,eventType:DOCTOR_REVIEW_CHANGED_EVENT_TYPE,eventVersion:1,attempts:1,payload:{review_id:doctorId,doctor_membership_id:doctorId,rating:5,change:'created',comment:'private',patient_profile_id:profileId}}),false);
});
