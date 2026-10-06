import { BellOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, List, Popover, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { pressable } from '../utils/pressable';
import { notificationsApi } from '../api';
import type { NotificationItem } from '../api/types';
import { EmptyBlock } from './ui';

/** 站内通知铃铛（站内信渠道），30s 轮询未读 */
export function NotificationBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationsApi.list,
    refetchInterval: 30_000,
  });

  const readMutation = useMutation({
    mutationFn: notificationsApi.markRead,
    onSuccess: (data) => queryClient.setQueryData(['notifications'], data),
  });
  const readAllMutation = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: (data) => queryClient.setQueryData(['notifications'], data),
  });

  // 受控弹层：点了某条通知就收起，否则跳转后面板还盖在目标页面上
  const [open, setOpen] = useState(false);

  const handleClick = (item: NotificationItem) => {
    if (!item.read) readMutation.mutate(item.id);
    if (item.link) {
      setOpen(false);
      navigate(item.link);
    }
  };

  return (
    <Popover
      rootClassName="notif-popover"
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomRight"
      title={
        <div className="u-flex-between">
          <span>通知</span>
          {(query.data?.unread ?? 0) > 0 && (
            <Button type="link" size="small" onClick={() => readAllMutation.mutate()}>
              全部已读
            </Button>
          )}
        </div>
      }
      content={
        <div className="notif-panel">
          {!query.data?.items.length ? (
            <EmptyBlock minHeight={140} description="暂无通知" />
          ) : (
            <List
              size="small"
              dataSource={query.data.items}
              renderItem={(item) => (
                <List.Item
                  className={item.read ? 'notif-item notif-item--read' : 'notif-item'}
                  {...pressable(() => handleClick(item))}
                >
                  <div className="u-w-full">
                    <div className="notif-row">
                      <Typography.Text strong={!item.read}>
                        {!item.read && <Badge status="processing" className="u-mr-8" />}
                        {item.title}
                      </Typography.Text>
                      <span className="notif-time">
                        {dayjs(item.createdAt).format('MM-DD HH:mm')}
                      </span>
                    </div>
                    {item.body && (
                      <Typography.Paragraph
                        className="notif-body"
                        ellipsis={{ rows: 2, tooltip: item.body }}
                      >
                        {item.body}
                      </Typography.Paragraph>
                    )}
                  </div>
                </List.Item>
              )}
            />
          )}
        </div>
      }
    >
      <Badge count={query.data?.unread ?? 0} size="small" offset={[-10, 10]}>
        <BellOutlined className="bell-icon" />
      </Badge>
    </Popover>
  );
}
