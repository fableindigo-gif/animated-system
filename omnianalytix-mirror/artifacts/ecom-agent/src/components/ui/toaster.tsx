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
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
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
      <ToastViewport />
    </ToastProvider>
  )
}
