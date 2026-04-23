import { useState } from "react"
import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

const VISIBLE_LIMIT = 3

function isActionInput(
  value: unknown,
): value is { label: string; onClick: () => void; altText?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "label" in value &&
    "onClick" in value &&
    typeof (value as { onClick: unknown }).onClick === "function"
  )
}

export function Toaster() {
  const { toasts, dismiss } = useToast()
  const [expanded, setExpanded] = useState(false)

  // Only count toasts that are still open (Radix sets `open: false` during the
  // exit animation but keeps them in the array until the removal delay elapses).
  // Counting closed toasts would inflate "+N more" with items the user can't see.
  const liveToasts = toasts.filter((t) => t.open !== false)
  const overflowCount = Math.max(0, liveToasts.length - VISIBLE_LIMIT)
  const visibleToasts = expanded ? liveToasts : liveToasts.slice(0, VISIBLE_LIMIT)

  return (
    <ToastProvider>
      {visibleToasts.map(function ({ id, title, description, action, ...props }) {
        const renderedAction = isActionInput(action) ? (
          <ToastAction
            altText={action.altText ?? action.label}
            onClick={action.onClick}
          >
            {action.label}
          </ToastAction>
        ) : (
          action
        )
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {renderedAction}
            <ToastClose />
          </Toast>
        )
      })}
      {overflowCount > 0 && !expanded && (
        <Toast
          key="__toast_overflow__"
          open={true}
          onOpenChange={() => {}}
          className="cursor-pointer"
          onClick={() => setExpanded(true)}
        >
          <div className="grid gap-1">
            <ToastTitle>+{overflowCount} more {overflowCount === 1 ? "notification" : "notifications"}</ToastTitle>
            <ToastDescription>Click to expand</ToastDescription>
          </div>
        </Toast>
      )}
      {expanded && liveToasts.length > VISIBLE_LIMIT && (
        <Toast
          key="__toast_collapse__"
          open={true}
          onOpenChange={() => {}}
          className="cursor-pointer"
          onClick={() => {
            setExpanded(false)
            liveToasts.slice(VISIBLE_LIMIT).forEach((t) => dismiss(t.id))
          }}
        >
          <div className="grid gap-1">
            <ToastTitle>Collapse & dismiss older</ToastTitle>
            <ToastDescription>Hide {liveToasts.length - VISIBLE_LIMIT} older notifications</ToastDescription>
          </div>
        </Toast>
      )}
      <ToastViewport />
    </ToastProvider>
  )
}
