-- AlterTable
ALTER TABLE "Resume" ADD COLUMN "parseStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Application" ADD COLUMN "matchSource" TEXT;

-- CreateTable
CREATE TABLE "AiCallLog" (
    "id" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION,
    "latencyMs" INTEGER NOT NULL,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiCallLog_createdAt_idx" ON "AiCallLog"("createdAt");

-- CreateIndex
CREATE INDEX "AiCallLog_capability_createdAt_idx" ON "AiCallLog"("capability", "createdAt");
