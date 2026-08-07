ALTER TABLE "Company" ADD COLUMN "isSynthetic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "HealthCheck" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'canary';
ALTER TABLE "HealthCheck" ADD COLUMN "steps" JSONB;
CREATE INDEX "HealthCheck_kind_ranAt_idx" ON "HealthCheck"("kind", "ranAt");
