/** 供 resume-text.spec 在独立进程里验证 PDF 抽取（pdfjs 不能在 Jest VM 里加载）；输出一行 JSON */
import { extractContacts, extractResumeText } from '../src/modules/candidates/resume-text';
import { makePdf } from '../src/test-utils/resume-fixtures';

void (async () => {
  const text = await extractResumeText(
    makePdf(['Name: Alex Chen', 'alex.chen@example.com', 'Phone 139-0013-9000', 'Java Spring 5 years']),
    'application/pdf',
    'cv.pdf',
  );
  console.log(JSON.stringify({ text, contacts: text ? extractContacts(text) : null }));
})();
