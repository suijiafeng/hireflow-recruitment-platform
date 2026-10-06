import type { KeyboardEvent, SyntheticEvent } from 'react';

/**
 * 让非按钮元素（span / div）也能用键盘操作：可 Tab 聚焦，Enter / 空格触发，读屏识别为按钮。
 * 用法：<span className="hf-link" {...pressable(() => open())}>详情</span>
 * role 可覆盖（如分段选择里的 'radio'）；disabled 时不可聚焦、不触发。
 */
export function pressable(
  handler: (e: SyntheticEvent) => void,
  options: { role?: string; disabled?: boolean; checked?: boolean } = {},
) {
  const { role = 'button', disabled = false, checked } = options;
  return {
    role,
    tabIndex: disabled ? -1 : 0,
    'aria-disabled': disabled || undefined,
    ...(checked !== undefined ? { 'aria-checked': checked } : {}),
    onClick: (e: SyntheticEvent) => {
      if (!disabled) handler(e);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (disabled) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        // 触发一次真实点击而不是直接调 handler：外层 Dropdown / Popover 注入到子元素上的点击逻辑也能被键盘触发
        e.currentTarget.click();
      }
    },
  };
}
