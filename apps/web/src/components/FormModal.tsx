import { App, Modal, type FormInstance, type ModalProps } from 'antd';
import { useEffect, useId } from 'react';

type Props = ModalProps & {
  /** 弹窗里的表单：有改动时取消 / Esc / 右上角关闭都会先确认 */
  form?: FormInstance;
  /** 表单之外的输入（如面评的原始记录）也算改动时传入 */
  isDirty?: () => boolean;
};

const FIRST_FIELD = [
  'input:not([type=hidden]):not([disabled]):not([readonly])',
  'textarea:not([disabled])',
  '.ant-select:not(.ant-select-disabled) input',
];

/**
 * 表单弹窗：
 * - 有未保存改动时关闭需确认，避免误按 Esc / 点关闭把半天写的内容丢掉
 *   （点遮罩关闭已在 main.tsx 全局禁用）；
 * - 打开后自动聚焦第一个可输入字段，打开即可键入。
 */
export function FormModal({ form, isDirty, onCancel, afterOpenChange, rootClassName, ...rest }: Props) {
  const { modal } = App.useApp();
  const scope = `hf-fm-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const dirty = () => Boolean(form?.isFieldsTouched()) || Boolean(isDirty?.());

  /** 聚焦第一个输入框；焦点已经在弹窗内容的输入框里（用户已开始输入）就不打扰 */
  const focusFirstField = () => {
    const active = document.activeElement;
    if (active?.closest(`.${scope} .ant-modal-body`) && active.matches('input, textarea')) return;
    const selector = FIRST_FIELD.map((f) => `.${scope} .ant-modal-body ${f}`).join(', ');
    document.querySelector<HTMLElement>(selector)?.focus();
  };

  // 不只依赖 afterOpenChange：它要等打开动画结束，页面在后台或动画被节流时可能迟迟不触发。
  // antd 打开时会先把焦点放到右上角关闭按钮，这里稍后接管到第一个输入框。
  const open = rest.open;
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(focusFirstField, 80);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const guardedCancel: ModalProps['onCancel'] = (e) => {
    if (!dirty()) {
      onCancel?.(e);
      return;
    }
    modal.confirm({
      title: '放弃未保存的内容？',
      content: '关闭后，已填写的内容不会保留。',
      okText: '放弃并关闭',
      okButtonProps: { danger: true },
      cancelText: '继续编辑',
      // 默认焦点放在「继续编辑」：顺手按回车不应该把内容丢掉
      focusable: { autoFocusButton: 'cancel' },
      onOk: () => onCancel?.(e),
    });
  };

  return (
    <Modal
      {...rest}
      rootClassName={[rootClassName, scope].filter(Boolean).join(' ')}
      onCancel={guardedCancel}
      afterOpenChange={(isOpen) => {
        if (isOpen) focusFirstField();
        afterOpenChange?.(isOpen);
      }}
    />
  );
}
