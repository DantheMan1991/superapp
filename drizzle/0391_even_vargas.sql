-- A question the interview may never decide is irrelevant (ADR 0098).
--
-- The counterweight to letting the model skip: "is there asbestos?" on a
-- pre-war remodel must not be judged moot because the answers went another
-- way. Defaults to false, so every question that exists today keeps the
-- behaviour it has -- most questions SHOULD be skippable, or a walk becomes
-- something people click through.

ALTER TABLE "job_estimate_outline_questions" ADD COLUMN "always_ask" boolean DEFAULT false NOT NULL;