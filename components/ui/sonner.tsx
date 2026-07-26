"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "hsl(var(--background) / 0.8)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "hsl(var(--border) / 0.5)",
          "--border-radius": "1rem",
          "backdropFilter": "blur(12px)",
          "boxShadow": "0 8px 32px rgba(0, 0, 0, 0.12)",
          "border": "1px solid hsl(var(--border) / 0.5)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
