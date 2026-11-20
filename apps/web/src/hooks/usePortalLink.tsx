import { Typography } from 'antd';
import { applicationsApi } from '../api';
import { extractErrorMessage } from '../api/client';
import { useAppDialogs } from './useAppDialogs';

export const portalUrl = (token: string) => `${window.location.origin}/portal/${token}`;

/**
 * 候选人页链接：一条应聘一个链接（选面试时间、答复 Offer、填写入职信息都在这一页）。
 * 由 HR 复制后通过邮件 / IM 发给候选人；复制不了（非 HTTPS、权限被拒）时弹窗手动复制。
 */
export function useCopyPortalLink(onRotated?: () => void) {
  const { message, modal } = useAppDialogs();
  return async (applicationId: string, rotate = false) => {
    try {
      const { token, expiresAt } = await applicationsApi.portalLink(applicationId, rotate);
      const url = portalUrl(token);
      if (rotate) onRotated?.();
      const until = expiresAt ? `，有效期至 ${new Date(expiresAt).toLocaleDateString('zh-CN')}` : '';
      try {
        await navigator.clipboard.writeText(url);
        message.success(rotate ? '已重新生成并复制新链接，旧链接已失效' : `候选人页链接已复制${until}，请发给候选人`);
      } catch {
        modal.info({
          title: '候选人页链接',
          content: (
            <Typography.Text copyable className="u-break-all">
              {url}
            </Typography.Text>
          ),
        });
      }
    } catch (error) {
      message.error(extractErrorMessage(error, '获取链接失败'));
    }
  };
}
