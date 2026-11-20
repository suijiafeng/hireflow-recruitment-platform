-- 流程简化：4 个阶段（按类型自动流转）、去掉职位与 Offer 审批、候选人页合一、入职只保留信息与合同、清理死字段、补索引

-- ───────────── 角色与权限 ─────────────
-- 候选人 / 新员工走候选人页，不需要内部账号：删除这两个从未使用的角色
DELETE FROM "Role" WHERE "code" IN ('CANDIDATE', 'NEW_HIRE');
UPDATE "Role" SET "dataScope" = 'ASSIGNED' WHERE "dataScope" = 'OWN';
ALTER TYPE "DataScope" RENAME TO "DataScope_old";
CREATE TYPE "DataScope" AS ENUM ('ALL', 'DEPARTMENT', 'ASSIGNED');
ALTER TABLE "Role" ALTER COLUMN "dataScope" DROP DEFAULT;
ALTER TABLE "Role" ALTER COLUMN "dataScope" TYPE "DataScope" USING ("dataScope"::text::"DataScope");
ALTER TABLE "Role" ALTER COLUMN "dataScope" SET DEFAULT 'ASSIGNED';
DROP TYPE "DataScope_old";

-- Offer 不再审批：原「审批 Offer」改为「查看 Offer」，已授予的角色（用人经理）保留查看能力
UPDATE "Permission" SET "code" = 'offer:read', "name" = '查看 Offer' WHERE "code" = 'offer:approve';
-- 入职材料上传随 OCR 一起删除
DELETE FROM "Permission" WHERE "code" = 'onboarding:upload';
UPDATE "Permission" SET "name" = '管理入职（信息核对 / 确认入职）' WHERE "code" = 'onboarding:manage';

-- ───────────── 职位：去掉「待审批」 ─────────────
UPDATE "Job" SET "status" = 'DRAFT' WHERE "status" = 'PENDING_APPROVAL';
ALTER TYPE "JobStatus" RENAME TO "JobStatus_old";
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'OPEN', 'PAUSED', 'CLOSED');
ALTER TABLE "Job" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Job" ALTER COLUMN "status" TYPE "JobStatus" USING ("status"::text::"JobStatus");
ALTER TABLE "Job" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "JobStatus_old";

-- ───────────── 阶段：加类型，合并成 4 个系统阶段 ─────────────
CREATE TYPE "StageKind" AS ENUM ('SCREENING', 'INTERVIEW', 'OFFER', 'ONBOARDING', 'CUSTOM');
ALTER TABLE "PipelineStage" ADD COLUMN "kind" "StageKind" NOT NULL DEFAULT 'CUSTOM';

UPDATE "PipelineStage" SET "kind" = (CASE
  WHEN "name" IN ('简历初筛', '初筛', '筛选', '简历筛选', '新简历') THEN 'SCREENING'
  WHEN "name" IN ('一面', '二面', '三面', '终面', '面试', '技术面', '复试', 'HR面', 'HR 面') THEN 'INTERVIEW'
  WHEN "name" IN ('Offer', 'offer', 'OFFER', '录用') THEN 'OFFER'
  WHEN "name" IN ('待入职', '已入职', '入职') THEN 'ONBOARDING'
  ELSE 'CUSTOM'
END)::"StageKind";

-- 同一职位同一类型的多个阶段（一面 + 二面、待入职 + 已入职）并到顺序最靠前的那个
CREATE TEMP TABLE "_stage_merge" AS
SELECT s."id" AS "oldId", (
  SELECT c."id" FROM "PipelineStage" c
  WHERE c."jobId" = s."jobId" AND c."kind" = s."kind"
  ORDER BY c."order", c."id" LIMIT 1
) AS "newId"
FROM "PipelineStage" s
WHERE s."kind" <> 'CUSTOM';
DELETE FROM "_stage_merge" WHERE "oldId" = "newId";
UPDATE "Application" a SET "stageId" = m."newId" FROM "_stage_merge" m WHERE a."stageId" = m."oldId";
DELETE FROM "PipelineStage" WHERE "id" IN (SELECT "oldId" FROM "_stage_merge");
DROP TABLE "_stage_merge";

-- 缺的系统阶段补上（排序键：放在前一个系统阶段之后）
CREATE TEMP TABLE "_stage_kinds" ("kind" "StageKind", "rank" INT, "label" TEXT);
INSERT INTO "_stage_kinds" VALUES ('SCREENING', 1, '筛选'), ('INTERVIEW', 2, '面试'), ('OFFER', 3, '录用'), ('ONBOARDING', 4, '入职');
CREATE TEMP TABLE "_stage_sort" ("id" TEXT PRIMARY KEY, "jobId" TEXT, "sortKey" NUMERIC);
INSERT INTO "_stage_sort" SELECT "id", "jobId", "order" FROM "PipelineStage";
INSERT INTO "_stage_sort"
SELECT 'stg_' || md5(j."id" || k."kind"::text), j."id", COALESCE((
  SELECT MAX(s."order") FROM "PipelineStage" s JOIN "_stage_kinds" sk ON sk."kind" = s."kind"
  WHERE s."jobId" = j."id" AND sk."rank" < k."rank"
), -1) + 0.5 + k."rank" * 0.01  -- 同一位置补多个阶段时按系统顺序排
FROM "Job" j CROSS JOIN "_stage_kinds" k
WHERE NOT EXISTS (SELECT 1 FROM "PipelineStage" s WHERE s."jobId" = j."id" AND s."kind" = k."kind");
INSERT INTO "PipelineStage" ("id", "jobId", "name", "kind", "order")
SELECT 'stg_' || md5(j."id" || k."kind"::text), j."id", k."label", k."kind", 0
FROM "Job" j CROSS JOIN "_stage_kinds" k
WHERE NOT EXISTS (SELECT 1 FROM "PipelineStage" s WHERE s."jobId" = j."id" AND s."kind" = k."kind");
UPDATE "PipelineStage" s SET "order" = r."rn"
FROM (SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "jobId" ORDER BY "sortKey", "id") - 1)::INT AS "rn" FROM "_stage_sort") r
WHERE s."id" = r."id";
UPDATE "PipelineStage" s SET "name" = k."label" FROM "_stage_kinds" k WHERE s."kind" = k."kind";
DROP TABLE "_stage_sort";
DROP TABLE "_stage_kinds";

-- ───────────── 候选人页：一条应聘一个链接 ─────────────
ALTER TABLE "Application" ADD COLUMN "portalToken" TEXT, ADD COLUMN "portalExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Application_portalToken_key" ON "Application"("portalToken");
-- 预筛（固定三问的规则判断，并非 AI）整体删除
ALTER TABLE "Application" DROP COLUMN "prescreen", DROP COLUMN "prescreenToken", DROP COLUMN "prescreenExpiresAt";
ALTER TABLE "Interview" DROP COLUMN "transcript", DROP COLUMN "portalToken", DROP COLUMN "portalExpiresAt";

-- ───────────── Offer：不审批，HR 直接发出 ─────────────
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'SENT', 'EXPIRED');
ALTER TABLE "Offer" ADD COLUMN "status" "OfferStatus" NOT NULL DEFAULT 'SENT';
UPDATE "Offer" SET "status" = (CASE "approvalStatus"::text
  WHEN 'SENT' THEN 'SENT'
  WHEN 'EXPIRED' THEN 'EXPIRED'
  ELSE 'DRAFT'
END)::"OfferStatus";
ALTER TABLE "Offer" DROP COLUMN "approvalStatus", DROP COLUMN "approvalNote", DROP COLUMN "portalToken", DROP COLUMN "portalExpiresAt";
DROP TYPE "OfferApprovalStatus";

-- ───────────── 入职：只保留入职信息与合同（去掉模拟 OCR、证件上传、模拟电子签、三方清单） ─────────────
ALTER TABLE "Onboarding" ADD COLUMN "info" JSONB, ADD COLUMN "infoSubmittedAt" TIMESTAMP(3), ADD COLUMN "completedAt" TIMESTAMP(3);
UPDATE "Onboarding" SET "completedAt" = "updatedAt" WHERE "status" = 'COMPLETED';
ALTER TABLE "Onboarding" DROP COLUMN "checklist", DROP COLUMN "documents", DROP COLUMN "ocrResults", DROP COLUMN "portalToken", DROP COLUMN "portalExpiresAt";

ALTER TABLE "Contract" ADD COLUMN "signedAt" TIMESTAMP(3), ADD COLUMN "signerName" TEXT;
UPDATE "Contract" SET "signedAt" = "updatedAt" WHERE "signStatus" IN ('SIGNED', 'ARCHIVED');
ALTER TYPE "ContractSignStatus" RENAME TO "ContractSignStatus_old";
CREATE TYPE "ContractSignStatus" AS ENUM ('PENDING', 'SIGNED');
ALTER TABLE "Contract" ALTER COLUMN "signStatus" DROP DEFAULT;
ALTER TABLE "Contract" ALTER COLUMN "signStatus" TYPE "ContractSignStatus" USING (
  CASE WHEN "signStatus"::text IN ('SIGNED', 'ARCHIVED') THEN 'SIGNED' ELSE 'PENDING' END::"ContractSignStatus"
);
ALTER TABLE "Contract" ALTER COLUMN "signStatus" SET DEFAULT 'PENDING';
DROP TYPE "ContractSignStatus_old";
ALTER TABLE "Contract" DROP COLUMN "evidenceNo", DROP COLUMN "fileKey";

-- ───────────── 死字段 ─────────────
ALTER TABLE "Evaluation" DROP COLUMN "aiDraft";

-- ───────────── 常用查询索引 ─────────────
CREATE INDEX "Job_departmentId_status_idx" ON "Job"("departmentId", "status");
CREATE INDEX "Candidate_email_idx" ON "Candidate"("email");
CREATE INDEX "Candidate_phone_idx" ON "Candidate"("phone");
CREATE INDEX "Resume_candidateId_idx" ON "Resume"("candidateId");
CREATE INDEX "Interview_applicationId_idx" ON "Interview"("applicationId");
CREATE INDEX "Evaluation_interviewerId_idx" ON "Evaluation"("interviewerId");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "ActivityLog_entityId_idx" ON "ActivityLog"("entityId");
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");
CREATE INDEX "ActivityLog_action_createdAt_idx" ON "ActivityLog"("action", "createdAt");
