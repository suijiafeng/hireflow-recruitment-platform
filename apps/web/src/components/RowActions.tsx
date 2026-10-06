import { Dropdown } from 'antd';
import { pressable } from '../utils/pressable';

export type RowAction = {
  key: string;
  /** 平铺位的文案尽量压到 2 字，操作列才能窄而齐；语义用 hint 补 */
  label: string;
  /** 悬停提示：label 省略掉的信息放这里，别让用户靠猜 */
  hint?: string;
  onClick: () => void;
  /** 危险操作，文字标红 */
  danger?: boolean;
  /** 无权限或状态不允许：置灰且不可点 */
  disabled?: boolean;
};

type Props = {
  /** 顺序即优先级：越靠前越可能被平铺，靠后的先被收进「···」 */
  actions: Array<RowAction | null | false | undefined>;
  /** 最多平铺几个，超出的收进「···」。默认 2 */
  max?: number;
};

/**
 * 表格行操作列。
 *
 * 统一约定：行本身不再挂 onClick（onRow），所有可点动作集中在这一列——行级点击是隐形入口，
 * 用户看不出哪些行可点、点了会发生什么，而且会和列内的链接抢事件。
 *
 * 排布规则只有一条：按传入顺序平铺前 max 个，多出来的收进「···」。
 * 优先级完全由数组顺序表达——主流程动作写前面，辅助功能写后面，不需要额外的标记位。
 * 固定平铺数也让各行右端对齐，不会因权限/状态不同而参差。
 */
export function RowActions({ actions, max = 2 }: Props) {
  const list = actions.filter(Boolean) as RowAction[];
  if (list.length === 0) return <span className="hf-faint">—</span>;

  const inline = list.slice(0, max);
  const overflow = list.slice(max);

  return (
    <span className="u-flex-end u-flex-gap-12">
      {inline.map((a) => (
        <span
          key={a.key}
          className={a.disabled ? 'hf-link hf-link--off' : a.danger ? 'hf-link hf-link--danger' : 'hf-link'}
          title={a.hint ?? a.label}
          {...pressable(
            (e) => {
              // 列里还有别的可点元素，且外层可能有 Dropdown/Drawer，统一拦掉冒泡
              e.stopPropagation();
              a.onClick();
            },
            { disabled: a.disabled },
          )}
        >
          {a.label}
        </span>
      ))}
      {overflow.length > 0 && (
        <Dropdown
          trigger={['click']}
          menu={{
            items: overflow.map((a) => ({
              key: a.key,
              label: a.label,
              danger: a.danger,
              disabled: a.disabled,
            })),
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation();
              overflow.find((a) => a.key === key)?.onClick();
            },
          }}
        >
          <span className="hf-more" aria-label="更多操作" {...pressable((e) => e.stopPropagation())}>
            ···
          </span>
        </Dropdown>
      )}
    </span>
  );
}
