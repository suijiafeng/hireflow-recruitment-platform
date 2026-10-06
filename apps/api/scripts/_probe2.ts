import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 }) });
(async () => {
  const w = { candidateId: 'cmuwhqfka001qojsbyw1yhdlv', jobId: 'cmuwhqfi4001aojsbzmxdn59o' };
  const a = await prisma.application.findUnique({ where: { candidateId_jobId: w }, select: { id: true, status: true } });
  console.log('1', a);
  try { const b = await prisma.application.findUnique({ where: { candidateId_jobId: w } }); console.log('2', b?.id, b?.candidateId); } catch (e: any) { console.log('2 ERR', e.message.split('\n').slice(-1)[0]); }
  const c = await prisma.application.findFirst({ where: w, select: { id: true } });
  console.log('3', c);
  await prisma.$disconnect();
})();
