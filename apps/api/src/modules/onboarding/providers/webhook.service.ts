import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ACTIVITY_ACTIONS } from '@hireflow/shared';
import type { JwtUser } from '../../../common/decorators/current-user.decorator';
import { ActivityLogService } from '../../activity-log/activity-log.service';

/**
 * 事件回调通知（合同签署完成 → Webhook 通知 IT 配设备开账号）。
 * 配置 ONBOARDING_WEBHOOK_URL 后真实 POST；失败只记录不阻断主流程。
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly url: string | undefined;

  constructor(
    config: ConfigService,
    private readonly activityLog: ActivityLogService,
  ) {
    this.url = config.get<string>('ONBOARDING_WEBHOOK_URL') || undefined;
  }

  async fire(event: string, entityId: string, payload: Record<string, unknown>, actor: JwtUser | null) {
    let delivered = false;
    if (this.url) {
      try {
        const response = await fetch(this.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload }),
          signal: AbortSignal.timeout(5000),
        });
        delivered = response.ok;
        if (!response.ok) this.logger.warn(`Webhook ${event} 响应 ${response.status}`);
      } catch (error) {
        this.logger.warn(`Webhook ${event} 投递失败：${error instanceof Error ? error.message : error}`);
      }
    } else {
      this.logger.log(`Webhook ${event}（未配置 ONBOARDING_WEBHOOK_URL，仅留痕）`);
    }
    await this.activityLog.recordAuto(actor, ACTIVITY_ACTIONS.WEBHOOK_FIRED, 'Application', entityId, {
      event,
      delivered,
      configured: Boolean(this.url),
      ...payload,
    });
  }
}
