-- 第 3 轮安全加固：JWT 吊销（tokenVersion）+ 门户链接硬过期

-- AlterTable
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Application" ADD COLUMN "prescreenExpiresAt" TIMESTAMP(3);
ALTER TABLE "Interview" ADD COLUMN "portalExpiresAt" TIMESTAMP(3);
ALTER TABLE "Offer" ADD COLUMN "portalExpiresAt" TIMESTAMP(3);
ALTER TABLE "Onboarding" ADD COLUMN "portalExpiresAt" TIMESTAMP(3);

-- 存量链接：上线前已发出的链接给 7 天宽限期，而不是一刀切失效（过期判断对 NULL 按「已过期」处理）
UPDATE "Application" SET "prescreenExpiresAt" = NOW() + INTERVAL '7 days' WHERE "prescreenToken" IS NOT NULL;
UPDATE "Interview" SET "portalExpiresAt" = NOW() + INTERVAL '7 days' WHERE "portalToken" IS NOT NULL;
UPDATE "Offer" SET "portalExpiresAt" = GREATEST(COALESCE("expiresAt", NOW()), NOW()) + INTERVAL '30 days' WHERE "portalToken" IS NOT NULL;
UPDATE "Onboarding" SET "portalExpiresAt" = NOW() + INTERVAL '30 days' WHERE "portalToken" IS NOT NULL;
