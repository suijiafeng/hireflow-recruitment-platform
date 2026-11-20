/**
 * 种子数据入口（幂等，可重复执行）。
 *
 * 基础数据（所有环境）：
 *   - 权限点 / 内置角色 upsert 对齐（ADMIN 始终全量对齐；其余角色只在首次创建时写默认权限，设置页的自定义权限重启后存活）；
 *   - 首个管理员：库里还没有任何管理员时创建。邮箱取 ADMIN_EMAIL（默认 admin@hireflow.local），
 *     密码取 ADMIN_PASSWORD；不给则随机生成并只在本次输出里打印一次。
 *
 * 演示数据（prisma/seed-demo.ts）：只在非生产环境执行，可用 SEED_DEMO=0 关闭。
 * NODE_ENV=production 时永远不写演示账号 / 演示业务数据，即使设置了 SEED_DEMO=1。
 */
import 'dotenv/config';
import { hashSync } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_DEFS, RoleCode } from '@hireflow/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { seedDemo } from './seed-demo';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function seedRbac() {
  for (const def of PERMISSION_DEFS) {
    await prisma.permission.upsert({
      where: { code: def.code },
      create: def,
      update: { name: def.name, group: def.group },
    });
  }

  for (const [code, def] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const existed = await prisma.role.findUnique({ where: { code } });
    const role = await prisma.role.upsert({
      where: { code },
      create: { code, name: def.name, dataScope: def.dataScope },
      update: { name: def.name, dataScope: def.dataScope },
    });
    // ADMIN 始终全量对齐（新增权限点自动补上，设置页也锁定不可编辑）；
    // 其余角色仅首次创建时写入默认值，此后不再覆盖——设置页的自定义权限要在重启/重部署后存活
    if (!existed && code !== RoleCode.ADMIN) {
      const permissions = await prisma.permission.findMany({
        where: { code: { in: [...def.permissions] } },
      });
      await prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });
    }
    if (code === RoleCode.ADMIN) {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      const permissions = await prisma.permission.findMany({
        where: { code: { in: [...def.permissions] } },
      });
      await prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });
    }
  }
  console.log(`✔ RBAC：${PERMISSION_DEFS.length} 个权限点 / ${Object.keys(DEFAULT_ROLE_PERMISSIONS).length} 个角色`);
}

/** 与 src/common/password-policy.ts 的规则一致：8–72 位，同时含字母和数字 */
function randomAdminPassword(): string {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#%';
  for (;;) {
    const pw = Array.from(randomBytes(16), (b) => ALPHABET[b % ALPHABET.length]).join('');
    if (/^(?=.*[A-Za-z])(?=.*\d).{8,72}$/.test(pw)) return pw;
  }
}

/** 首个管理员：只在「库里没有任何管理员」时创建，之后再跑种子不会改动任何账号或密码 */
async function ensureFirstAdmin() {
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: RoleCode.ADMIN } });
  if ((await prisma.userRole.count({ where: { roleId: adminRole.id } })) > 0) return;

  const email = (process.env.ADMIN_EMAIL?.trim() || 'admin@hireflow.local').toLowerCase();
  const given = process.env.ADMIN_PASSWORD;
  if (given && !/^(?=.*[A-Za-z])(?=.*\d).{8,72}$/.test(given)) {
    throw new Error('ADMIN_PASSWORD 需 8–72 位，且同时包含字母和数字');
  }
  const password = given || randomAdminPassword();
  const existing = await prisma.user.findUnique({ where: { email } });
  const user =
    existing ??
    (await prisma.user.create({
      data: { email, name: '系统管理员', passwordHash: hashSync(password, 10), passwordChangedAt: new Date() },
    }));
  await prisma.userRole.create({ data: { userId: user.id, roleId: adminRole.id } });

  if (existing) {
    console.log(`✔ 已把现有账号 ${email} 设为管理员（密码未改动）`);
  } else if (given) {
    console.log(`✔ 首个管理员：${email}（密码取自 ADMIN_PASSWORD）`);
  } else {
    console.log('┌──────────────────────────────────────────────────────────');
    console.log('│ 首个管理员已创建（随机密码只显示这一次，请立即登录并修改）');
    console.log(`│ 账号：${email}`);
    console.log(`│ 密码：${password}`);
    console.log('└──────────────────────────────────────────────────────────');
  }
}

function demoEnabled(): boolean {
  const flag = process.env.SEED_DEMO?.trim().toLowerCase();
  if (process.env.NODE_ENV === 'production') {
    if (flag === '1' || flag === 'true') console.warn('⚠ 生产环境不写演示数据，已忽略 SEED_DEMO');
    return false;
  }
  return flag !== '0' && flag !== 'false';
}

async function main() {
  await seedRbac();
  // 演示环境先建好演示账号（含 admin@hireflow.local），首个管理员检查随后就会跳过
  if (demoEnabled()) {
    await seedDemo(prisma);
  } else {
    console.log('… 跳过演示数据（生产环境或 SEED_DEMO=0）');
  }
  await ensureFirstAdmin();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
