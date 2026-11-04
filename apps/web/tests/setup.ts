import { vi } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
  value: () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }),
});
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
// jsdom 不实现伪元素样式；antd 的滚动条测量只需普通元素样式。
const getComputedStyle = window.getComputedStyle;
vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element));
