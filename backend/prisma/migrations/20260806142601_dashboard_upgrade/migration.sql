-- Employee: add optional display name (previously only email was collected)
ALTER TABLE "Employee" ADD COLUMN "name" TEXT;

-- AuditLog: which AI site the event happened on
ALTER TABLE "AuditLog" ADD COLUMN "platform" TEXT;

CREATE INDEX "AuditLog_companyId_employeeId_createdAt_idx" ON "AuditLog"("companyId", "employeeId", "createdAt");

-- HealthCheck: hourly synthetic canary check results
CREATE TABLE "HealthCheck" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL,
    "detail" TEXT,

    CONSTRAINT "HealthCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HealthCheck_companyId_ranAt_idx" ON "HealthCheck"("companyId", "ranAt");

ALTER TABLE "HealthCheck" ADD CONSTRAINT "HealthCheck_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
