import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, ConfigProvider } from 'antd';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalApi } from '../src/api';
import type { PortalView } from '../src/api/types';
import { RetiredPortalLink } from '../src/pages/portal/PortalLinkError';
import { PortalPage } from '../src/pages/portal/PortalPage';

vi.mock('../src/api', () => ({
  portalApi: { view: vi.fn(), pick: vi.fn(), respond: vi.fn(), saveInfo: vi.fn(), sign: vi.fn(), ask: vi.fn() },
}));

const base: PortalView = {
  company: '测试公司',
  candidateName: '林一',
  jobTitle: '前端工程师',
  department: '研发部',
  status: 'ACTIVE' as PortalView['status'],
  expiresAt: '2040-02-01T00:00:00.000Z',
  hrContact: { name: '王招聘', email: 'hr@hireflow.local' },
  step: 'interview',
  interviews: [
    {
      id: 'iv1',
      round: 1,
      roundLabel: '一面',
      durationMins: 60,
      scheduledAt: null,
      meetingUrl: null,
      location: null,
      status: 'SCHEDULED',
      interviewers: ['张面试'],
      // 同一个空闲档切出两个交集：必须分别可选，并提交所选交集的起点
      slots: [
        { id: 'same-slot', startAt: '2040-01-01T02:00:00.000Z', endAt: '2040-01-01T03:00:00.000Z' },
        { id: 'same-slot', startAt: '2040-01-01T04:00:00.000Z', endAt: '2040-01-01T05:00:00.000Z' },
      ],
    },
  ],
  offer: null,
  onboarding: null,
};

const offerStep: PortalView = {
  ...base,
  step: 'offer',
  interviews: [{ ...base.interviews[0], scheduledAt: '2040-01-01T02:00:00.000Z', status: 'COMPLETED', slots: [] }],
  offer: {
    status: 'SENT' as never,
    decision: null,
    decisionReason: null,
    respondedAt: null,
    declineReasons: ['薪资不符合预期', '其他'],
    preparing: false,
    salary: { base: 30000, bonusMonths: 2 },
    grade: 'P6',
    startDate: '2040-03-01',
    sentAt: '2040-01-10T00:00:00.000Z',
    expiresAt: '2040-01-17T00:00:00.000Z',
    extendedOnce: false,
  },
};

const onboardingStep: PortalView = {
  ...offerStep,
  step: 'onboarding',
  offer: { ...(offerStep.offer as object), decision: 'ACCEPTED' } as PortalView['offer'],
  onboarding: {
    status: 'IN_PROGRESS',
    fields: [
      { key: 'idNumber', label: '身份证号', sensitive: true },
      { key: 'bankName', label: '开户银行', sensitive: false },
    ],
    info: null,
    infoSubmittedAt: null,
    contract: {
      templateName: '标准劳动合同 v1',
      signStatus: 'PENDING',
      variables: { candidateName: '林一', jobTitle: '前端工程师' },
      signedAt: null,
      signerName: null,
    },
    completedAt: null,
  },
};

let client: QueryClient;
let router: ReturnType<typeof createMemoryRouter>;

function setup(path = '/portal/tok-1') {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  router = createMemoryRouter(
    [
      { path: '/portal/:token', Component: PortalPage },
      { path: '/portal/*', Component: RetiredPortalLink },
    ],
    { initialEntries: [path] },
  );
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <App>
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </App>
    </ConfigProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  router.dispose();
  client.clear();
});

describe('候选人页（一条应聘一个链接）', () => {
  it('面试阶段：同一空闲档的两个交集分别可选，提交所选交集的起点', async () => {
    vi.mocked(portalApi.view).mockResolvedValue(structuredClone(base));
    vi.mocked(portalApi.pick).mockResolvedValue({
      ...base,
      interviews: [{ ...base.interviews[0], scheduledAt: base.interviews[0].slots[1].startAt, slots: [] }],
    });
    const user = setup();
    await screen.findByText('选一个方便的时间');
    const options = screen.getAllByRole('button').filter((el) => el.classList.contains('hf-opt'));
    expect(options).toHaveLength(2);
    await user.click(options[1]);
    expect(options[1].classList.contains('hf-opt--on')).toBe(true);
    await user.click(screen.getByRole('button', { name: '确认这个时间' }));
    await user.click(await screen.findByRole('button', { name: '确认时间' }));
    await waitFor(() =>
      expect(portalApi.pick).toHaveBeenCalledWith('tok-1', 'iv1', 'same-slot', base.interviews[0].slots[1].startAt),
    );
    await screen.findByText('面试官');
  });

  it('Offer 阶段：展示方案并可接受', async () => {
    vi.mocked(portalApi.view).mockResolvedValue(structuredClone(offerStep));
    vi.mocked(portalApi.respond).mockResolvedValue(structuredClone(onboardingStep));
    const user = setup();
    await screen.findByText('¥30,000');
    expect(screen.getByText(/14 薪/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /接受 Offer/ }));
    await user.click(await screen.findByRole('button', { name: '确认接受' }));
    await waitFor(() => expect(portalApi.respond).toHaveBeenCalledWith('tok-1', 'ACCEPTED', undefined));
    await screen.findByText('1. 入职信息');
  });

  it('入职阶段：前端按同一规则校验身份证号，合同需输入本人姓名才能确认', async () => {
    vi.mocked(portalApi.view).mockResolvedValue(structuredClone(onboardingStep));
    const user = setup();
    await screen.findByText('1. 入职信息');
    await user.type(screen.getByLabelText('身份证号'), '123');
    await user.type(screen.getByLabelText('开户银行'), '招商银行');
    await user.click(screen.getByRole('button', { name: '提交入职信息' }));
    await screen.findByText('请填写 18 位身份证号');
    expect(portalApi.saveInfo).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: '确认合同' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    vi.mocked(portalApi.sign).mockResolvedValue(structuredClone(onboardingStep));
    await user.type(screen.getByLabelText('本人姓名'), '林一');
    await user.click(screen.getByRole('button', { name: '确认合同' }));
    await waitFor(() => expect(portalApi.sign).toHaveBeenCalledWith('tok-1', '林一'));
  });

  it('流程已结束时不再展示面试、薪资和入职信息', async () => {
    vi.mocked(portalApi.view).mockResolvedValue({ ...base, step: 'closed', interviews: [], offer: null, onboarding: null });
    setup();
    await screen.findByText('本次招聘流程已结束');
    expect(screen.queryByText('选一个方便的时间')).toBeNull();
  });

  it('旧版分开的门户地址统一显示「链接无效」', async () => {
    setup('/portal/offer/old-token');
    await screen.findAllByText('链接无效');
    expect(portalApi.view).not.toHaveBeenCalled();
  });
});
