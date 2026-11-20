import { App } from 'antd';
import type { ModalFuncProps } from 'antd';
import { useMemo } from 'react';

/** 文案像「删除 / 淘汰 / 停用 / 驳回 / 放弃 / 清空 / 移除 / 撤回」的确认按钮按危险操作处理 */
export const DESTRUCTIVE_OK = /删除|淘汰|停用|驳回|放弃|清空|移除|撤回|丢弃|作废|婉拒/;

/**
 * 确认 / 提示框的统一默认值（antd 的 confirm 默认没有右上角 ×，和普通弹窗不一致）：
 * - 右上角 × 可关闭，Esc 同样关闭；点遮罩不关闭（与全站 Modal 一致，避免误触）
 * - 垂直居中，按钮「取消在左、主操作在右」
 * - 危险操作：主按钮标红，默认焦点放在「取消」，顺手按回车不会误删
 */
export function withDialogDefaults(config: ModalFuncProps, kind: 'confirm' | 'info' = 'confirm'): ModalFuncProps {
  const okText = typeof config.okText === 'string' ? config.okText : '';
  const danger = Boolean(config.okButtonProps?.danger) || DESTRUCTIVE_OK.test(okText);
  return {
    closable: true,
    centered: true,
    keyboard: true,
    ...(kind === 'confirm' ? { cancelText: '取消' } : { okText: '知道了' }),
    ...config,
    okButtonProps: { ...(danger ? { danger: true } : {}), ...config.okButtonProps },
    ...(danger && kind === 'confirm' && !config.focusable ? { focusable: { autoFocusButton: 'cancel' as const } } : {}),
  };
}

/** App.useApp() 的替代：message / notification 原样透传，modal 的五个静态方法套上统一默认值 */
export function useAppDialogs() {
  const app = App.useApp();
  const modal = useMemo(
    () => ({
      ...app.modal,
      confirm: (c: ModalFuncProps) => app.modal.confirm(withDialogDefaults(c)),
      info: (c: ModalFuncProps) => app.modal.info(withDialogDefaults(c, 'info')),
      success: (c: ModalFuncProps) => app.modal.success(withDialogDefaults(c, 'info')),
      warning: (c: ModalFuncProps) => app.modal.warning(withDialogDefaults(c, 'info')),
      error: (c: ModalFuncProps) => app.modal.error(withDialogDefaults(c, 'info')),
    }),
    [app.modal],
  );
  return { ...app, modal };
}
