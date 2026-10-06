import { useEffect } from 'react';

/** 浏览器标签页标题：多开标签时能分清是哪一页 */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}
