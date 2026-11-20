/**
 * 客户端 CSV 导出。
 *
 * 口径约定：导出的是「页面上这个人能看到的数据」——调用方必须先按权限脱敏再传进来，
 * 不能把未脱敏的原始数据丢给本函数。导出是另一条数据出口，绕过 RBAC 就等于开了后门。
 */

/** RFC4180 转义：含分隔符/引号/换行的字段要包引号，内部引号翻倍 */
function escapeCell(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 触发浏览器下载一个 CSV。
 * 带 UTF-8 BOM——否则 Excel 打开中文列名会是乱码，这是国内用户第一个会踩的坑。
 */
export function downloadCsv(fileName: string, header: string[], rows: Array<Array<unknown>>) {
  const text = [header, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n');
  const blob = new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(fileName.endsWith('.csv') ? fileName : `${fileName}.csv`, blob);
}

/** 触发浏览器下载任意文件内容（服务端生成的 Excel 等） */
export function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立刻 revoke 在部分浏览器会打断下载，下一轮事件循环再释放
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
