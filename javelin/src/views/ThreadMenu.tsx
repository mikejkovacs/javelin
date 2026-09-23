import {
  Button,
  Icon,
  Menu,
  MenuGroup,
  MenuItem,
} from '@stripe/ui-extension-sdk/ui';
import type { ThreadSummary } from '../state/threadReducer';

/**
 * Kebab Menu in the drawer header's actions row. Shows up to 5 most-recent
 * threads (Decision A) plus an "All conversations →" entry that opens the
 * FocusView management surface (C-3).
 *
 * Menu IDs:
 *   - thread_id (e.g. "thr_abc...") → switch to that thread
 *   - "__empty__" → no-op (rendered when no threads exist)
 *   - "__all_conv__" → open the AllConversationsView FocusView
 *
 * Caller wires `onSelect(id)` to handle all three cases.
 *
 * Trigger uses `size="small"` per the universal icon-only button pattern
 * (Pass 1 — applies to +, kebab, Copy, trash uniformly).
 */
export function ThreadMenu({
  threads,
  onSelect,
}: {
  threads: ThreadSummary[];
  onSelect: (threadId: string) => void;
}) {
  const recent = threads.slice(0, 5);
  return (
    <Menu
      trigger={
        <Button type="secondary">
          <Icon name="more" />
        </Button>
      }
      onAction={(key) => onSelect(String(key))}
    >
      <MenuGroup title="Recent">
        {recent.length === 0 ? (
          <MenuItem id="__empty__" disabled>
            No conversations yet
          </MenuItem>
        ) : (
          recent.map((t) => (
            <MenuItem key={t.thread_id} id={t.thread_id}>
              {t.title ?? 'New conversation'}
            </MenuItem>
          ))
        )}
      </MenuGroup>
      <MenuGroup>
        <MenuItem id="__all_conv__">All conversations →</MenuItem>
      </MenuGroup>
    </Menu>
  );
}
