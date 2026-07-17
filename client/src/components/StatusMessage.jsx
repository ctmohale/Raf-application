import { useEffect, useMemo, useRef } from 'react';
import { useToast } from './ToastProvider.jsx';

function getMessageText(children) {
  if (children === null || children === undefined || children === false) return '';
  if (Array.isArray(children)) return children.map(getMessageText).join('');
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (children?.props?.children) return getMessageText(children.props.children);
  return String(children || '');
}

export default function StatusMessage({ type = 'info', children }) {
  const { showToast } = useToast();
  const lastMessageRef = useRef('');
  const message = useMemo(() => getMessageText(children).trim(), [children]);

  useEffect(() => {
    if (!message) return;

    const key = `${type}:${message}`;
    if (lastMessageRef.current === key) return;

    lastMessageRef.current = key;
    showToast({ type, message });
  }, [message, showToast, type]);

  if (!children) return null;
  return null;
}
