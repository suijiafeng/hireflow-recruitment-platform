import {
  BookOutlined,
  CopyOutlined,
  FileTextOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { App, Button, Input, Popconfirm, Spin } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { helpdeskApi } from '../../api';
import { extractErrorMessage } from '../../api/client';
import { EmptyBlock } from '../../components/ui';
import { pressable } from '../../utils/pressable';

interface ChatMessage {
  role: 'user' | 'bot';
  text: string;
  at: string;
  sources?: Array<{ id: string; title: string }>;
  provider?: string;
}

/** 快捷问题与种子知识库文档一一对应 */
const QUICK_QUESTIONS = [
  'WiFi 密码是什么？',
  '公积金比例是多少？',
  '年假有几天，怎么申请？',
  '报销什么时候打款？',
  '试用期多久，怎么转正？',
  '加班怎么调休？',
];

const STORAGE_KEY = 'arthr:helpdesk-chat:v1';
const MAX_MESSAGES = 200;

function loadMessages(): ChatMessage[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** 一条消息：气泡 + 出处降为一行文本（不再用彩色 Tag） */
function ChatRow({ msg, onCopy }: { msg: ChatMessage; onCopy: (text: string) => void }) {
  const isUser = msg.role === 'user';
  return (
    <div className={isUser ? 'hf-chat-row hf-chat-row--user' : 'hf-chat-row'}>
      {!isUser && (
        <span className="hf-chat-avatar hf-chat-avatar--bot">
          <RobotOutlined />
        </span>
      )}
      <div className="hf-chat-col">
        <div className={isUser ? 'hf-bubble hf-bubble--user' : 'hf-bubble'}>{msg.text}</div>
        {!isUser && (
          <div className="hf-chat-meta">
            {(msg.sources?.length ?? 0) > 0 && (
              <>
                <FileTextOutlined />
                <span>出处：{msg.sources!.map((s) => s.title).join(' · ')}</span>
                <span>·</span>
              </>
            )}
            <span className="hf-td--num">{dayjs(msg.at).format('HH:mm')}</span>
            <span className="hf-link" {...pressable(() => onCopy(msg.text))} title='复制回答'>
              <CopyOutlined  /> 
            </span>
          </div>
        )}
      </div>
      {isUser && (
        <span className="hf-chat-avatar hf-chat-avatar--user">
          <UserOutlined />
        </span>
      )}
    </div>
  );
}

export function HelpdeskPage() {
  const { message } = App.useApp();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [failedQuestion, setFailedQuestion] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  const scrollToBottom = () => setTimeout(() => listRef.current?.scrollTo({ top: 99999, behavior: 'smooth' }), 50);

  const askMutation = useMutation({
    mutationFn: helpdeskApi.ask,
    onSuccess: (data) => {
      setFailedQuestion(null);
      setMessages((prev) =>
        [
          ...prev,
          {
            role: 'bot' as const,
            text: data.answer,
            at: new Date().toISOString(),
            sources: data.sources,
            provider: data.aiMeta.provider,
          },
        ].slice(-MAX_MESSAGES),
      );
      scrollToBottom();
    },
    onError: (error, question) => {
      setFailedQuestion(question);
      message.error(extractErrorMessage(error, '回答失败'));
      scrollToBottom();
    },
  });

  const docsQuery = useQuery({ queryKey: ['helpdesk-docs'], queryFn: helpdeskApi.docs });

  const ask = (question: string) => {
    const q = question.trim();
    if (q.length < 2 || askMutation.isPending) return;
    setFailedQuestion(null);
    setMessages((prev) =>
      [...prev, { role: 'user' as const, text: q, at: new Date().toISOString() }].slice(-MAX_MESSAGES),
    );
    setInput('');
    askMutation.mutate(q);
    scrollToBottom();
  };

  const retry = () => {
    if (!failedQuestion || askMutation.isPending) return;
    askMutation.mutate(failedQuestion);
  };

  const clearChat = () => {
    setMessages([]);
    setFailedQuestion(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const copyAnswer = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success('回答已复制');
    } catch {
      message.warning('复制失败，请手动选择文本复制');
    }
  };

  const lastProvider = [...messages].reverse().find((m) => m.role === 'bot')?.provider;

  return (
    <div className="hf-page">
      <div className="hf-body">
        <div className="hf-cols">
          {/* 对话区：铺满，不套 Card */}
          <div className="hf-panel hf-panel--grow">
            <div className="hf-panel-head">
              <span className="hf-panel-title">
                <RobotOutlined /> 入职问答助手
              </span>
              <span className="u-flex-gap-12">
                <span className="hf-faint">
                  {lastProvider === 'mock' ? '规则引擎' : (lastProvider ?? '规则引擎')} · 仅依据制度文档作答
                </span>
                {messages.length > 0 && (
                  <Popconfirm title="清空当前对话记录？" okText="清空" onConfirm={clearChat}>
                    <span className="hf-link">清空对话</span>
                  </Popconfirm>
                )}
              </span>
            </div>

            {messages.length === 0 ? (
              <div className="hf-panel-body hf-chat-welcome">
                <div className="hf-state-icon">
                  <RobotOutlined />
                </div>
                <div className="hf-state-title">有入职问题，直接问我</div>
                <p className="hf-state-desc">
                  回答基于公司制度文档并附出处，覆盖 WiFi、五险一金、休假、报销、考勤、试用期等主题。
                </p>
                <div className="hf-chip-row">
                  {QUICK_QUESTIONS.map((q) => (
                    <span key={q} className="hf-chip" {...pressable(() => ask(q))}>
                      {q}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div ref={listRef} className="hf-panel-body hf-chat-list">
                {messages.map((m, i) => (
                  <ChatRow key={`${m.at}-${i}`} msg={m} onCopy={copyAnswer} />
                ))}
                {askMutation.isPending && (
                  <div className="hf-chat-row">
                    <span className="hf-chat-avatar hf-chat-avatar--bot">
                      <RobotOutlined />
                    </span>
                    <div className="hf-bubble hf-bubble--typing">
                      <Spin size="small" /> 正在检索制度文档…
                    </div>
                  </div>
                )}
                {failedQuestion && !askMutation.isPending && (
                  <div className="hf-chat-row">
                    <span className="hf-chat-avatar hf-chat-avatar--bot">
                      <RobotOutlined />
                    </span>
                    <div className="hf-bubble hf-bubble--error">
                      这条没有回答成功，可能是网络或服务波动。
                      <span className="hf-link u-ml-8" {...pressable(retry)}>
                        重试
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 输入区：整块一个描边框，发送按钮在右下 */}
            <div className="hf-composer">
              <Input.TextArea
                value={input}
                variant="borderless"
                autoSize={{ minRows: 2, maxRows: 8 }}
                onChange={(e) => setInput(e.target.value)}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                }}
                onPressEnter={(e) => {
                  if (e.shiftKey || composingRef.current) return;
                  e.preventDefault();
                  ask(input);
                }}
                placeholder="输入问题，如：试用期多久可以转正？"
              />
              <div className="hf-composer-foot">
                <span className="hf-faint">Enter 发送，Shift + Enter 换行 · 回答仅供参考，重要事项请与 HR 确认</span>
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={() => ask(input)}
                  loading={askMutation.isPending}
                  disabled={!input.trim()}
                >
                  发送
                </Button>
              </div>
            </div>
          </div>

          {/* 右栏：常见问题（chip）+ 知识库范围 */}
          <div className="hf-rail hf-rail--narrow">
            <div className="hf-panel hf-panel--fit">
              <div className="hf-panel-head">
                <span className="hf-panel-title">
                  <QuestionCircleOutlined /> 常见问题
                </span>
              </div>
              <div className="hf-chip-row hf-chip-row--pad">
                {QUICK_QUESTIONS.map((q) => (
                  <span key={q} className="hf-chip" {...pressable(() => ask(q))}>
                    {q}
                  </span>
                ))}
              </div>
            </div>

            <div className="hf-panel hf-panel--grow">
              <div className="hf-panel-head">
                <span className="hf-panel-title">
                  <BookOutlined /> 知识库范围
                </span>
                <span className="hf-faint">{docsQuery.data?.length ?? 0} 篇 · HR 维护</span>
              </div>
              <div className="hf-panel-body">
                {docsQuery.isLoading ? (
                  <Spin size="small" />
                ) : !docsQuery.data?.length ? (
                  <EmptyBlock minHeight={120} description="暂无知识库文档，由 HR 在后台维护" />
                ) : (
                  docsQuery.data.map((doc) => (
                    <div key={doc.id} className="hf-doc-row">
                      <span className="hf-secondary hf-doc-title">{doc.title}</span>
                      <span className="hf-faint hf-td--right">{doc.tags.join(' · ')}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="hf-panel-foot hf-panel-foot--tight hf-notice--flat">
                <span className="hf-faint">
                  没找到答案？联系 HR：<span className="hf-link">hr@arthr.local</span>（工作日 10:00–18:00）
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
