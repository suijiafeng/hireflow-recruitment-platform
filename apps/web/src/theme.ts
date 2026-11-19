import type { ThemeConfig } from 'antd';

/**
 * 全站设计 token 唯一来源 —— 规范：「用规则换省心，用克制换舒服」
 * - 8px 网格：间距只用 4/8/16/24/32；控件高 28/36/44（16px 正文的紧凑档）
 * - 配色：1 主色 + 语义色（700 深阶做文字过 WCAG AA，50 浅阶只做底色）
 *   + 中性色分 6 层（页底/面板/下沉/两级发丝线/控件描边），全实色无渐变
 * - 字号阶梯以 16px 正文为基准，全偶数、下限 12（12/14/16/22/26/28），圆角只用 4/6/8
 * - 阴影只留 2 档，卡片层级靠描边而非投影
 */
export const BRAND = {
  primary: '#18181B', // 唯一强调色：墨黑，只用在主按钮、激活态、焦点
  primaryDark: '#3F3F46', // hover：近黑按钮略提亮，变化才看得见
  primary50: '#F4F4F5', // 选中浅底

  success: '#059669',
  success50: '#ECFDF5',
  warning: '#B45309',
  warning50: '#FFFBEB',
  error: '#DC2626',
  error50: '#FEF2F2',
} as const;

/** 中性面：微弱底色分层，白面板永远比周围亮 */
export const SURFACE = {
  page: '#f4f5f6', // 页面底
  panel: '#ffffff', // 面板 / 卡片
  sunken: '#fafafa', // 列内容区、输入框底
  sider: '#17181a', // 侧边栏深底
  line: '#e6e7e9', // 主分隔线
  lineSoft: '#eeeff1', // 发丝分隔
  lineStrong: '#d8dade', // 控件描边
} as const;

/** 中性文字色阶：单一墨色 #1a1a1a 按透明度分层（secondary 白底实测对比 5.7:1 过 AA） */
export const INK = {
  primary: '#1a1a1a',
  secondary: 'rgba(26, 26, 26, 0.65)',
  muted: 'rgba(26, 26, 26, 0.45)',
  faint: 'rgba(26, 26, 26, 0.25)',
  light: 'rgba(26, 26, 26, 0.12)',
} as const;

/** 字号阶梯（16 为基准，全偶数、下限 12）：12 徽标 / 14 辅助与元信息 / 16 正文与卡标题 / 22 页标题 / 26 数据大字 / 28 展示 */
export const FONT = { badge: 12, meta: 14, body: 16, title: 16, heading: 22, num: 26, display: 28 } as const;

export const LINE = {
  default: SURFACE.line,
  light: SURFACE.lineSoft,
  heavy: SURFACE.lineStrong,
} as const;

/** 阴影：只保留 2 档，卡片默认无投影 */
export const SHADOW = {
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.04)',
  md: '0 4px 12px -2px rgba(0, 0, 0, 0.06)',
  card: 'none',
  drag: '0 8px 20px rgba(26, 26, 26, 0.14)',
} as const;

export function buildTheme(disableMotion: boolean): ThemeConfig {
  return {
    token: {
      colorPrimary: BRAND.primary,
      colorPrimaryHover: BRAND.primaryDark,
      colorPrimaryActive: '#09090B',
      colorPrimaryBg: BRAND.primary50,
      colorPrimaryBgHover: '#E4E4E7',
      colorInfo: BRAND.primary,
      colorLink: BRAND.primary,
      colorSuccess: BRAND.success,
      colorWarning: BRAND.warning,
      colorError: BRAND.error,

      // 字号阶梯（level 1-3 禁用，页标题 level4=22、卡标题 level5=16）
      fontSize: 16,
      fontSizeSM: 14,
      fontSizeLG: 18,
      fontSizeHeading1: 28,
      fontSizeHeading2: 26,
      fontSizeHeading3: 22,
      fontSizeHeading4: 22,
      fontSizeHeading5: 16,

      lineHeight: 1.5715,
      lineHeightSM: 1.6667,
      lineHeightLG: 1.5,
      lineHeightHeading1: 1.3077,
      lineHeightHeading2: 1.3334,
      lineHeightHeading3: 1.4,
      lineHeightHeading4: 1.4,
      lineHeightHeading5: 1.5715,

      // 圆角只用 4/6/8
      borderRadius: 6,
      borderRadiusLG: 8,
      borderRadiusSM: 4,
      borderRadiusXS: 4,

      colorBgLayout: SURFACE.page,
      colorBgContainer: SURFACE.panel,
      colorBgElevated: SURFACE.panel,

      colorBorder: LINE.default,
      colorBorderSecondary: LINE.light,

      colorText: INK.primary,
      colorTextSecondary: INK.secondary,
      colorTextTertiary: INK.muted,
      colorTextQuaternary: INK.faint,

      boxShadow: SHADOW.sm,
      boxShadowSecondary: SHADOW.md,

      motion: !disableMotion,
      motionDurationFast: '0.12s',
      motionDurationMid: '0.15s',
      motionDurationSlow: '0.15s',
      motionEaseInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',

      // 控件高：紧凑档 36，密集场景 28，表单/登录 44（16px 正文对应）
      controlHeight: 36,
      controlHeightSM: 28,
      controlHeightLG: 44,

      marginXS: 4,
      marginSM: 8,
      margin: 16,
      marginMD: 16,
      marginLG: 24,
      marginXL: 32,

      paddingXS: 4,
      paddingSM: 8,
      padding: 16,
      paddingMD: 16,
      paddingLG: 24,
      paddingXL: 32,
    },
    components: {
      Card: {
        headerFontSize: 16,
        headerFontSizeSM: 16,
        bodyPadding: 16,
        bodyPaddingSM: 12,
        headerPadding: 16,
        headerPaddingSM: 12,
        borderRadiusLG: 8,
      },
      Layout: {
        headerBg: SURFACE.panel,
        headerHeight: 56,
        siderBg: SURFACE.sider,
        bodyBg: SURFACE.page,
      },
      // 侧边栏菜单：选中态不整块刷主色，改「主色低透明底 + 内嵌左侧色条」（见 app.css）
      Menu: {
        darkItemBg: 'transparent',
        darkSubMenuItemBg: 'rgba(255, 255, 255, 0.04)',
        itemBorderRadius: 6,
        itemHeight: 38,
        itemPaddingInline: 12,
        darkItemSelectedBg: 'rgba(255, 255, 255, 0.08)',
        darkItemColor: 'rgba(255, 255, 255, 0.72)',
        darkItemHoverBg: 'rgba(255, 255, 255, 0.06)',
        darkItemHoverColor: '#ffffff',
        darkItemSelectedColor: '#ffffff',
        darkGroupTitleColor: 'rgba(255, 255, 255, 0.3)',
        iconSize: 16,
      },
      /**
       * 对齐 .hf-table：表头 40px / 行高 48px / 表头 13px 中文不加字距、
       * 行分隔用发丝线而表头下沿用主线。数值不要随手改——10 张表全靠这一处统一。
       */
      Table: {
        headerColor: '#71717A',
        headerBg: SURFACE.sunken,
        headerSplitColor: 'transparent', // 原设计表头列之间没有竖线
        rowHoverBg: '#fafbfc',
        rowSelectedBg: BRAND.primary50,
        rowSelectedHoverBg: BRAND.primary50,
        borderColor: SURFACE.lineSoft, // 行分隔：发丝线
        headerBorderRadius: 0, // 圆角交给外层容器，表头自己不要切角
        cellPaddingBlock: 0, // 行高由 .hf-atable 的 height 控制，避免 padding 叠加
        cellPaddingInline: 12,
        cellFontSize: 16,
        footerBg: SURFACE.panel,
      },
      Statistic: {
        titleFontSize: 14,
        contentFontSize: 26,
      },
      Button: {
        borderRadius: 6,
        controlHeight: 36,
        controlHeightSM: 30,
        controlHeightLG: 44,
        primaryShadow: 'none',
        defaultShadow: 'none',
        fontWeight: 500,
      },
      Input: {
        borderRadius: 6,
        controlHeight: 36,
        controlHeightSM: 30,
        controlHeightLG: 44,
        activeBorderColor: BRAND.primary,
        hoverBorderColor: BRAND.primary,
        activeShadow: '0 0 0 3px rgba(24, 24, 27, 0.12)',
      },
      // 非警示 Tag 默认灰（装饰性颜色零容忍）
      Tag: {
        borderRadius: 4,
        defaultBg: SURFACE.page,
        defaultColor: INK.secondary,
      },
      Modal: {
        borderRadiusLG: 8,
        titleFontSize: 18,
        headerBg: 'transparent',
      },
      Drawer: {
        borderRadiusLG: 8,
      },
      Dropdown: {
        borderRadius: 6,
        controlItemBgHover: SURFACE.page,
      },
      Select: {
        borderRadius: 6,
        controlHeight: 36,
        controlHeightSM: 30,
        controlHeightLG: 44,
      },
      DatePicker: {
        borderRadius: 6,
        controlHeight: 36,
      },
      Breadcrumb: {
        fontSize: 14,
      },
      Alert: {
        borderRadiusLG: 6,
      },
    },
  };
}
